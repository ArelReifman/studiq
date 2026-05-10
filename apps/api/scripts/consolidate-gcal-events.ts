/**
 * One-shot consolidation: existing approved bookings have one gcal event per
 * 30-minute slot. After the half-hour migration, a 2.5h lesson shows up as
 * 5 separate calendar events. This script:
 *
 *   1. Finds every (teacher, student, date) tuple with approved bookings
 *      that are part of a consecutive group (>1 row).
 *   2. Deletes each old per-slot calendar event (best-effort).
 *   3. Creates ONE new event spanning the full group.
 *   4. Updates all sibling rows to share the new gcal_event_id.
 *
 * Idempotent if interrupted — re-running re-picks up groups whose bookings
 * still don't share a single gcal_event_id.
 *
 * Run: bun run apps/api/scripts/consolidate-gcal-events.ts
 */
import { inArray } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { lessonBookings } from "../src/db/schema.js";
import {
  createCalendarEvent,
  deleteCalendarEvent,
} from "../src/services/google-calendar.js";

interface Row {
  id: string;
  teacher_id: string;
  student_id: string;
  date: string;
  start_time: string;
  end_time: string;
  gcal_event_id: string | null;
}

async function main() {
  // Pull every approved future booking. (Past lessons we leave alone — no
  // value in rewriting history.)
  const today = new Date().toISOString().slice(0, 10);
  const rows = (await db
    .select({
      id: lessonBookings.id,
      teacher_id: lessonBookings.teacher_id,
      student_id: lessonBookings.student_id,
      date: lessonBookings.date,
      start_time: lessonBookings.start_time,
      end_time: lessonBookings.end_time,
      gcal_event_id: lessonBookings.gcal_event_id,
    })
    .from(lessonBookings)
    .where(
      // Include rows without gcal_event_id too — an approval that originally
      // failed to create an event still belongs in the consecutive group and
      // should be folded into the merged event.
      inArray(lessonBookings.status, ["approved", "cancel_requested"])
    )) as Row[];

  // Group by (teacher, student, date), then sort by start_time and split
  // into runs of consecutive slots.
  const buckets = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.date < today) continue;
    const k = `${r.teacher_id}|${r.student_id}|${r.date}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(r);
  }

  let groupsHandled = 0;
  let groupsSkipped = 0;
  let eventsDeleted = 0;
  let eventsCreated = 0;

  for (const [key, bucket] of buckets) {
    bucket.sort((a, b) => a.start_time.localeCompare(b.start_time));

    // Build consecutive runs
    const runs: Row[][] = [];
    let cur: Row[] = [];
    for (const r of bucket) {
      if (cur.length === 0 || cur[cur.length - 1]!.end_time === r.start_time) {
        cur.push(r);
      } else {
        runs.push(cur);
        cur = [r];
      }
    }
    if (cur.length) runs.push(cur);

    for (const run of runs) {
      if (run.length <= 1) {
        groupsSkipped++;
        continue;
      }
      // If they already share ONE non-null gcal_event_id, nothing to do.
      // If they all share `null` (gcal creation failed at approval time),
      // we still need to create the merged event — don't skip.
      const ids = new Set(run.map((r) => r.gcal_event_id));
      if (ids.size === 1 && !ids.has(null)) {
        groupsSkipped++;
        continue;
      }

      const head = run[0]!;
      const tail = run[run.length - 1]!;
      console.log(
        `[group] ${key} ${head.start_time}–${tail.end_time} (${run.length} rows)`
      );

      // Delete each old per-slot event (best-effort — 404s are fine).
      for (const r of run) {
        if (r.gcal_event_id) {
          try {
            await deleteCalendarEvent(r.teacher_id, r.gcal_event_id);
            eventsDeleted++;
          } catch (e) {
            console.warn(`  delete failed ${r.gcal_event_id}:`, e);
          }
        }
      }

      // Create one merged event spanning the full run.
      const eventId = await createCalendarEvent({
        date: head.date,
        start_time: head.start_time,
        end_time: tail.end_time,
        student_id: head.student_id,
        teacher_id: head.teacher_id,
      });

      if (!eventId) {
        console.warn(`  create failed for ${key} — leaving rows unlinked`);
        // Clear stale event IDs so the bookings stop pointing at deleted events.
        await db
          .update(lessonBookings)
          .set({ gcal_event_id: null })
          .where(
            inArray(
              lessonBookings.id,
              run.map((r) => r.id)
            )
          );
        continue;
      }

      eventsCreated++;
      await db
        .update(lessonBookings)
        .set({ gcal_event_id: eventId })
        .where(
          inArray(
            lessonBookings.id,
            run.map((r) => r.id)
          )
        );
      groupsHandled++;
    }
  }

  console.log(`\nDone:`);
  console.log(`  groups consolidated: ${groupsHandled}`);
  console.log(`  groups skipped (already merged or single-slot): ${groupsSkipped}`);
  console.log(`  old events deleted: ${eventsDeleted}`);
  console.log(`  new merged events created: ${eventsCreated}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
