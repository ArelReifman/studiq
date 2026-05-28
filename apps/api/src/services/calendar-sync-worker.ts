/**
 * Calendar background-sync worker (Phase 3B-1 scaffold).
 *
 * Polls `lesson_bookings` for rows whose Google Calendar event still needs
 * to be created/updated, processes a small batch, and writes status back.
 *
 * Current state of the system (Phase 3B-1):
 *   No existing flow writes `calendar_sync_status = 'pending'`. Every
 *   booking is created with the schema default `'not_required'` and the
 *   inline `await createCalendarEvent(...)` in bookings.ts still runs
 *   exactly as before. Therefore this worker will SELECT zero rows and
 *   return `{ processed: 0 }` until Phase 3B-2 wires `pending` writes in.
 *
 * Why ship it now: lets us deploy + verify the cron route, the auth gate,
 * and the empty-batch path with zero risk to existing behavior.
 *
 * Safety:
 *   - `FOR UPDATE SKIP LOCKED` lets multiple worker invocations run
 *     without colliding on the same booking row.
 *   - Idempotency: if a row already has `gcal_event_id` set, we treat it
 *     as already synced and only flip status — we never re-create.
 *   - Failures bump `calendar_retry_count` with exponential backoff.
 *     After 5 attempts, `calendar_sync_status` becomes `'failed'` and the
 *     row is parked until a manual retry endpoint resets it (Phase 3B-2).
 */

import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { lessonBookings } from "../db/schema.js";
import { createCalendarEvent } from "./google-calendar.js";

const BATCH_SIZE = 25;
const MAX_RETRIES = 5;

// Exponential backoff for retry scheduling, in milliseconds.
// Indices match `calendar_retry_count` after the *failed* attempt:
//   1st failure → wait  1m before next try
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

/**
 * Run one batch of the calendar sync worker.
 * Returns counts so the cron endpoint can surface them in its response.
 */
export async function runCalendarSyncBatch(): Promise<SyncResult> {
  // postgres-js's `db.execute(sql\`...\`)` template does NOT auto-serialize
  // JS Date objects — passing one throws
  // "The string argument must be of type string or … Received an instance of Date".
  // We bind ISO strings explicitly; `timestamptz` columns parse them natively.
  const nowIso = new Date().toISOString();

  // Claim a batch of pending/failed rows whose retry window has come due.
  // `FOR UPDATE SKIP LOCKED` ensures concurrent workers each grab disjoint
  // sets — important because Vercel may invoke cron + a manual trigger
  // simultaneously.
  // postgres-js + drizzle: `db.execute` returns an array-like directly
  // (no `.rows` wrapper, unlike `node-postgres`). Casting to a typed array
  // keeps the rest of the function strongly typed.
  type ClaimedRow = {
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
  const claimed = (await db.execute(sql`
    SELECT id, teacher_id, student_id, date, start_time, end_time,
           course_id, gcal_event_id, calendar_retry_count
      FROM lesson_bookings
     WHERE calendar_sync_status IN ('pending','failed')
       AND (calendar_next_retry_at IS NULL OR calendar_next_retry_at <= ${nowIso})
     ORDER BY calendar_next_retry_at NULLS FIRST
     LIMIT ${BATCH_SIZE}
     FOR UPDATE SKIP LOCKED
  `)) as unknown as ClaimedRow[];

  const rows = claimed;
  const result: SyncResult = {
    processed: rows.length,
    succeeded: 0,
    failed: 0,
    parked: 0,
  };

  for (const row of rows) {
    // Already has an event ID — treat as synced and exit fast. Defends
    // against a race where the inline path completed between SELECT and
    // worker processing.
    if (row.gcal_event_id) {
      await db.execute(sql`
        UPDATE lesson_bookings
           SET calendar_sync_status = 'synced',
               calendar_sync_error  = NULL,
               calendar_next_retry_at = NULL,
               updated_at = NOW()
         WHERE id = ${row.id}
      `);
      result.succeeded++;
      continue;
    }

    try {
      const eventId = await createCalendarEvent({
        date: row.date,
        start_time: row.start_time,
        end_time: row.end_time,
        student_id: row.student_id,
        teacher_id: row.teacher_id,
        // course_name / teacher_name are optional in the GCal payload;
        // the existing service handles their absence gracefully.
      });

      if (!eventId) {
        throw new Error("createCalendarEvent returned null");
      }

      await db.execute(sql`
        UPDATE lesson_bookings
           SET gcal_event_id          = ${eventId},
               calendar_sync_status   = 'synced',
               calendar_sync_error    = NULL,
               calendar_next_retry_at = NULL,
               updated_at             = NOW()
         WHERE id = ${row.id}
      `);
      result.succeeded++;
    } catch (err) {
      const nextCount = row.calendar_retry_count + 1;
      const message = err instanceof Error ? err.message : String(err);

      if (nextCount >= MAX_RETRIES) {
        // Park the row: stop retrying until a manual endpoint resets it.
        await db.execute(sql`
          UPDATE lesson_bookings
             SET calendar_sync_status   = 'failed',
                 calendar_sync_error    = ${message},
                 calendar_retry_count   = ${nextCount},
                 calendar_next_retry_at = NULL,
                 updated_at             = NOW()
           WHERE id = ${row.id}
        `);
        result.parked++;
      } else {
        const backoff = BACKOFF_MS[Math.min(nextCount - 1, BACKOFF_MS.length - 1)]!;
        const nextRetryAtIso = new Date(Date.now() + backoff).toISOString();
        await db.execute(sql`
          UPDATE lesson_bookings
             SET calendar_sync_status   = 'pending',
                 calendar_sync_error    = ${message},
                 calendar_retry_count   = ${nextCount},
                 calendar_next_retry_at = ${nextRetryAtIso},
                 updated_at             = NOW()
           WHERE id = ${row.id}
        `);
        result.failed++;
      }

      console.warn(
        `[calendar-sync] booking ${row.id} attempt ${nextCount}/${MAX_RETRIES} failed: ${message}`
      );
    }
  }

  // Suppress unused-field warning until used in Phase 3B-2.
  void lessonBookings;
  return result;
}
