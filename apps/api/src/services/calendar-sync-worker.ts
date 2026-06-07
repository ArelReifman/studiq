/**
 * Calendar background-sync worker.
 *
 * Two entry points share the same group-aware core:
 *
 *   • `syncBookingsByIds(ids)` — invoked via `waitUntil` from a request
 *     handler immediately after the DB insert (Phase 3B-2 hybrid path).
 *
 *   • `runCalendarSyncBatch()` — invoked by Vercel Cron once a day as a
 *     safety net for any 'pending' rows the `waitUntil` path missed.
 *
 * Both routes reach `syncBookingGroup(seedId)`, which:
 *   1. Opens a transaction.
 *   2. Loads the seed row + every approved sibling for the same
 *      (teacher_id, student_id, date) with `SELECT … FOR UPDATE` — this
 *      locks the whole multi-slot group until COMMIT.
 *   3. Finds the *consecutive* sub-chain that contains the seed (same
 *      end_time→start_time rule the Telegram coalescer uses).
 *   4. If any row in the group already has `gcal_event_id`, propagates
 *      that ID to every row and marks them 'synced' — no GCal call.
 *   5. Otherwise calls `createCalendarEvent` exactly once for the full
 *      span and writes the resulting ID to every row in the group.
 *   6. On failure, updates every row in the group identically with the
 *      same retry counter and backoff.
 *
 * Why a transaction + FOR UPDATE: prevents the cron and the immediate
 * `waitUntil` invocation from each calling `createCalendarEvent` for the
 * same group and producing duplicate events. The first transaction wins,
 * the second blocks until COMMIT, then sees the freshly-written
 * `gcal_event_id` and takes the fast no-op branch.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { createCalendarEvent } from "./google-calendar.js";
import { resolveCourseName } from "../lib/course-resolver.js";

const BATCH_SIZE = 25;
const MAX_RETRIES = 5;

// Exponential backoff for retry scheduling, in milliseconds.
// Indices match `calendar_retry_count` after the *failed* attempt:
//   1st failure → wait  1m
//   2nd failure → wait  5m
//   3rd failure → wait 20m
//   4th failure → wait  1h
//   5th failure → wait  6h, then status flips to 'failed'
const BACKOFF_MS = [60_000, 5 * 60_000, 20 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

export interface SyncResult {
  processed: number;
  succeeded: number;
  failed: number;
  parked: number; // moved from 'pending' to 'failed' (exhausted retries)
}

// Row shape used internally — minimal projection of lesson_bookings.
type GroupRow = {
  id: string;
  teacher_id: string;
  student_id: string;
  date: string;
  start_time: string;
  end_time: string;
  course_id: string | null;
  gcal_event_id: string | null;
  calendar_retry_count: number;
};

// Outcome of processing a single group — fed back to the batch caller so
// it can update its counters and dedupe siblings already handled.
interface GroupResult {
  ids: string[];
  outcome: "synced" | "failed" | "parked" | "noop";
}

/**
 * Atomically sync the calendar event for the consecutive booking group
 * that contains `seedId`. Idempotent and safe to call from multiple
 * contexts concurrently — the FOR UPDATE lock serializes them.
 */
async function syncBookingGroup(seedId: string): Promise<GroupResult> {
  return await db.transaction(async (tx) => {
    // 1. Load seed.
    const seedRows = (await tx.execute(sql`
      SELECT id, teacher_id, student_id, date, start_time, end_time,
             course_id, gcal_event_id, calendar_retry_count
        FROM lesson_bookings
       WHERE id = ${seedId}
       FOR UPDATE
    `)) as unknown as GroupRow[];
    const seed = seedRows[0];
    if (!seed) return { ids: [], outcome: "noop" };

    // 2. Load every approved sibling for this (teacher, student, date)
    // with FOR UPDATE — locks the entire potential group until COMMIT,
    // preventing a concurrent worker from racing through createEvent.
    const siblings = (await tx.execute(sql`
      SELECT id, teacher_id, student_id, date, start_time, end_time,
             course_id, gcal_event_id, calendar_retry_count
        FROM lesson_bookings
       WHERE teacher_id = ${seed.teacher_id}
         AND student_id = ${seed.student_id}
         AND date       = ${seed.date}
         AND status     = 'approved'
       ORDER BY start_time
       FOR UPDATE
    `)) as unknown as GroupRow[];

    // 3. Find the *consecutive* sub-chain containing the seed (same
    // end_time→start_time rule used by the Telegram coalescer in
    // bookings.ts). Anything outside the chain is a different lesson.
    const seedIdx = siblings.findIndex((r) => r.id === seed.id);
    if (seedIdx === -1) {
      // Should never happen — the seed row IS one of the siblings.
      return { ids: [seed.id], outcome: "noop" };
    }
    let lo = seedIdx;
    let hi = seedIdx;
    while (lo > 0 && siblings[lo - 1]!.end_time === siblings[lo]!.start_time) lo--;
    while (
      hi < siblings.length - 1 &&
      siblings[hi]!.end_time === siblings[hi + 1]!.start_time
    ) hi++;
    const group = siblings.slice(lo, hi + 1);
    const groupIds = group.map((r) => r.id);

    // Build a properly-parameterized IN list. Drizzle's `sql.join` emits
    // one placeholder per id (… IN ($1, $2, $3)) — safer than string
    // interpolation and immune to whatever the row IDs look like.
    const idList = sql.join(
      groupIds.map((id) => sql`${id}`),
      sql`, `
    );

    // 4. Idempotency: if anyone in the group already has a GCal event
    // ID, propagate it to everyone and exit without calling Google.
    const existingEventId = group.find((r) => r.gcal_event_id)?.gcal_event_id;
    if (existingEventId) {
      await tx.execute(sql`
        UPDATE lesson_bookings
           SET gcal_event_id          = ${existingEventId},
               calendar_sync_status   = 'synced',
               calendar_sync_error    = NULL,
               calendar_next_retry_at = NULL,
               updated_at             = NOW()
         WHERE id IN (${idList})
      `);
      return { ids: groupIds, outcome: "synced" };
    }

    // 5. Single GCal create for the full span.
    const lessonStart = group[0]!.start_time;
    const lessonEnd = group[group.length - 1]!.end_time;
    try {
      const courseName = await resolveCourseName(seed.course_id, seed.student_id);

      const eventId = await createCalendarEvent({
        date: seed.date,
        start_time: lessonStart,
        end_time: lessonEnd,
        student_id: seed.student_id,
        teacher_id: seed.teacher_id,
        ...(courseName ? { course_name: courseName } : {}),
      });

      if (!eventId) throw new Error("createCalendarEvent returned null");

      // 5a. Propagate eventId + 'synced' to every row in the group.
      await tx.execute(sql`
        UPDATE lesson_bookings
           SET gcal_event_id          = ${eventId},
               calendar_sync_status   = 'synced',
               calendar_sync_error    = NULL,
               calendar_next_retry_at = NULL,
               updated_at             = NOW()
         WHERE id IN (${idList})
      `);
      return { ids: groupIds, outcome: "synced" };
    } catch (err) {
      // 6. Failure path — keep all rows in the group on the same retry
      // count and next-retry timestamp so they stay coherent.
      const nextCount = seed.calendar_retry_count + 1;
      const message = err instanceof Error ? err.message : String(err);

      if (nextCount >= MAX_RETRIES) {
        await tx.execute(sql`
          UPDATE lesson_bookings
             SET calendar_sync_status   = 'failed',
                 calendar_sync_error    = ${message},
                 calendar_retry_count   = ${nextCount},
                 calendar_next_retry_at = NULL,
                 updated_at             = NOW()
           WHERE id IN (${idList})
        `);
        console.warn(
          `[calendar-sync] group seed=${seed.id} parked after ${nextCount} attempts: ${message}`
        );
        return { ids: groupIds, outcome: "parked" };
      }

      const backoff = BACKOFF_MS[Math.min(nextCount - 1, BACKOFF_MS.length - 1)]!;
      const nextRetryAtIso = new Date(Date.now() + backoff).toISOString();
      await tx.execute(sql`
        UPDATE lesson_bookings
           SET calendar_sync_status   = 'pending',
               calendar_sync_error    = ${message},
               calendar_retry_count   = ${nextCount},
               calendar_next_retry_at = ${nextRetryAtIso},
               updated_at             = NOW()
         WHERE id IN (${idList})
      `);
      console.warn(
        `[calendar-sync] group seed=${seed.id} attempt ${nextCount}/${MAX_RETRIES} failed: ${message}`
      );
      return { ids: groupIds, outcome: "failed" };
    }
  });
}

/**
 * Background-trigger entry point.
 *
 * Called via `waitUntil(syncBookingsByIds(createdIds))` immediately after
 * a teacher-lesson POST commits. Only the first ID is needed — the worker
 * discovers the rest of the group via the same teacher/student/date
 * chain detection.
 */
export async function syncBookingsByIds(ids: string[]): Promise<SyncResult> {
  const result: SyncResult = { processed: 0, succeeded: 0, failed: 0, parked: 0 };
  if (ids.length === 0) return result;

  // Passing only the first id is sufficient: syncBookingGroup walks the
  // chain. Passing all of them would re-process the same group N times.
  const seedId = ids[0]!;
  const out = await syncBookingGroup(seedId);
  result.processed = out.ids.length;
  if (out.outcome === "synced") result.succeeded = out.ids.length;
  else if (out.outcome === "failed") result.failed = out.ids.length;
  else if (out.outcome === "parked") result.parked = out.ids.length;
  return result;
}

/**
 * Cron entry point — runs once a day as a safety net.
 *
 * Claims a small batch of due rows (pending or failed with retry due),
 * then processes each through the group-aware path. A `processedIds` set
 * dedupes siblings that were already handled as part of a previous
 * group in the same batch.
 */
export async function runCalendarSyncBatch(): Promise<SyncResult> {
  const nowIso = new Date().toISOString();

  type ClaimedRow = { id: string };
  const claimed = (await db.execute(sql`
    SELECT id
      FROM lesson_bookings
     WHERE calendar_sync_status IN ('pending','failed')
       AND (calendar_next_retry_at IS NULL OR calendar_next_retry_at <= ${nowIso})
     ORDER BY calendar_next_retry_at NULLS FIRST
     LIMIT ${BATCH_SIZE}
     FOR UPDATE SKIP LOCKED
  `)) as unknown as ClaimedRow[];

  const result: SyncResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    parked: 0,
  };
  const processedIds = new Set<string>();

  for (const row of claimed) {
    if (processedIds.has(row.id)) continue;
    const out = await syncBookingGroup(row.id);
    for (const id of out.ids) processedIds.add(id);
    result.processed += out.ids.length;
    if (out.outcome === "synced") result.succeeded += out.ids.length;
    else if (out.outcome === "failed") result.failed += out.ids.length;
    else if (out.outcome === "parked") result.parked += out.ids.length;
  }

  return result;
}
