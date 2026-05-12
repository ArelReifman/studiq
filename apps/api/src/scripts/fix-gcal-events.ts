/**
 * fix-gcal-events.ts
 *
 * One-off script to backfill Google Calendar events for existing approved bookings:
 *   1. Groups approved bookings by (teacher, student, date, consecutive slots).
 *   2. For groups with a single gcal_event_id: updates title/description/span.
 *   3. For groups with multiple gcal_event_ids (NEEDS_MERGE):
 *      - Picks the earliest-start event as primary.
 *      - Updates primary to cover the full lesson span with correct title.
 *      - Deletes duplicate events from Google Calendar.
 *      - Updates DB so every slot in the group points to the primary event ID.
 *   4. Skips groups with no gcal_event_id (NO_GCAL).
 *
 * Usage (dry-run, no changes):
 *   DRY_RUN=true npx tsx src/scripts/fix-gcal-events.ts
 *
 * Usage (apply):
 *   npx tsx src/scripts/fix-gcal-events.ts
 */

import "dotenv/config";
import { db } from "../db/client.js";
import { lessonBookings, students, profiles, courses, teacherGoogleTokens } from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { updateCalendarEvent, deleteCalendarEvent } from "../services/google-calendar.js";

const DRY_RUN = process.env["DRY_RUN"] === "true";

function log(msg: string) {
  console.log(`[fix-gcal] ${msg}`);
}

function timeToMin(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

interface BookingRow {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  student_id: string;
  teacher_id: string;
  gcal_event_id: string | null;
  student_name: string;
  teacher_name: string;
  course_name: string | null;
}

interface LessonGroup {
  teacher_id: string;
  student_id: string;
  date: string;
  lesson_start: string;
  lesson_end: string;
  student_name: string;
  teacher_name: string;
  course_name: string;
  /** Sorted by start_time ascending */
  slots: BookingRow[];
  /** Unique non-null gcal_event_ids (sorted by the slot's start_time) */
  gcal_ids: string[];
  status: "OK" | "NEEDS_MERGE" | "NO_GCAL";
}

async function fetchApprovedBookings(): Promise<BookingRow[]> {
  // Use aliases so we can join `profiles` twice (student + teacher).
  const studentProfiles = alias(profiles, "student_profiles");
  const teacherProfiles = alias(profiles, "teacher_profiles");

  const rows = await db
    .select({
      id: lessonBookings.id,
      date: lessonBookings.date,
      start_time: lessonBookings.start_time,
      end_time: lessonBookings.end_time,
      student_id: lessonBookings.student_id,
      teacher_id: lessonBookings.teacher_id,
      gcal_event_id: lessonBookings.gcal_event_id,
      student_name: studentProfiles.full_name,
      teacher_name: teacherProfiles.full_name,
      course_name: courses.name,
    })
    .from(lessonBookings)
    .innerJoin(studentProfiles, eq(studentProfiles.id, lessonBookings.student_id))
    .innerJoin(teacherProfiles, eq(teacherProfiles.id, lessonBookings.teacher_id))
    .leftJoin(students, eq(students.id, lessonBookings.student_id))
    .leftJoin(courses, eq(courses.id, students.primary_course_id))
    .where(eq(lessonBookings.status, "approved"));

  return rows;
}

// Build groups using the same consecutive-slot logic as groupConsecutiveBookings.
function buildGroups(bookings: BookingRow[]): LessonGroup[] {
  const sorted = [...bookings].sort((a, b) =>
    a.date !== b.date
      ? a.date.localeCompare(b.date)
      : a.teacher_id !== b.teacher_id
      ? a.teacher_id.localeCompare(b.teacher_id)
      : a.student_id !== b.student_id
      ? a.student_id.localeCompare(b.student_id)
      : a.start_time.localeCompare(b.start_time)
  );

  const groups: LessonGroup[] = [];

  for (const b of sorted) {
    const last = groups[groups.length - 1];
    const isConsecutive =
      !!last &&
      last.teacher_id === b.teacher_id &&
      last.student_id === b.student_id &&
      last.date === b.date &&
      last.lesson_end === b.start_time;

    if (isConsecutive) {
      last.slots.push(b);
      last.lesson_end = b.end_time;
      if (b.gcal_event_id && !last.gcal_ids.includes(b.gcal_event_id)) {
        last.gcal_ids.push(b.gcal_event_id);
      }
    } else {
      groups.push({
        teacher_id: b.teacher_id,
        student_id: b.student_id,
        date: b.date,
        lesson_start: b.start_time,
        lesson_end: b.end_time,
        student_name: b.student_name,
        teacher_name: b.teacher_name,
        course_name: b.course_name ?? "",
        slots: [b],
        gcal_ids: b.gcal_event_id ? [b.gcal_event_id] : [],
        status: "OK",
      });
    }
  }

  for (const g of groups) {
    if (g.gcal_ids.length === 0) g.status = "NO_GCAL";
    else if (g.gcal_ids.length > 1) g.status = "NEEDS_MERGE";
    else g.status = "OK";
  }

  return groups;
}

/** Collapse runs of whitespace to a single space and trim edges. */
function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function buildTitle(g: LessonGroup): { summary: string; description: string } {
  const studentName = normalizeName(g.student_name);
  const teacherName = normalizeName(g.teacher_name);
  const teacherFirst = teacherName.split(" ")[0] ?? teacherName;
  const courseName  = g.course_name; // already trimmed from DB
  const hasCourse  = !!courseName;
  const hasStudent = !!studentName;

  // "שיעור פרטי - {course} - {student}" with graceful fallbacks
  let summary = "שיעור פרטי";
  if (hasCourse && hasStudent) summary = `שיעור פרטי - ${courseName} - ${studentName}`;
  else if (hasCourse)  summary = `שיעור פרטי - ${courseName}`;
  else if (hasStudent) summary = `שיעור פרטי - ${studentName}`;

  const descLines: string[] = [];
  if (hasStudent) descLines.push(`סטודנט: ${studentName}`);
  descLines.push(`מורה: ${teacherFirst}`);
  if (hasCourse) descLines.push(`קורס: ${courseName}`);
  descLines.push(`זמן שיעור: ${g.lesson_start}–${g.lesson_end}`);

  return { summary, description: descLines.join("\n") };
}

async function main() {
  log(DRY_RUN ? "=== DRY-RUN mode (no changes) ===" : "=== APPLY mode ===");

  // Fetch teacher data for token check
  const tokenRows = await db
    .select({ teacher_id: teacherGoogleTokens.teacher_id })
    .from(teacherGoogleTokens);
  const teachersWithTokens = new Set(tokenRows.map((r) => r.teacher_id));

  const allBookings = await fetchApprovedBookings();
  log(`Fetched ${allBookings.length} approved booking slots`);

  const groups = buildGroups(allBookings);
  log(`Built ${groups.length} lesson groups`);

  const ok = groups.filter((g) => g.status === "OK");
  const needsMerge = groups.filter((g) => g.status === "NEEDS_MERGE");
  const noGcal = groups.filter((g) => g.status === "NO_GCAL");

  log(`  OK (update title/span only): ${ok.length}`);
  log(`  NEEDS_MERGE (multiple gcal_ids): ${needsMerge.length}`);
  log(`  NO_GCAL (skipped): ${noGcal.length}`);

  // ── Print summary ───────────────────────────────────────────────────────────
  console.log("\n=== ACTION SUMMARY ===\n");

  for (const g of ok) {
    const { summary } = buildTitle(g);
    console.log(
      `[UPDATE] ${g.date} ${g.lesson_start}–${g.lesson_end} | ${g.student_name}` +
        `\n         event: ${g.gcal_ids[0]}` +
        `\n         title: ${summary}\n`
    );
  }

  for (const g of needsMerge) {
    const { summary } = buildTitle(g);
    const primary = g.gcal_ids[0]!;
    const duplicates = g.gcal_ids.slice(1);
    console.log(
      `[MERGE]  ${g.date} ${g.lesson_start}–${g.lesson_end} | ${g.student_name}` +
        `\n         primary:    ${primary}` +
        `\n         delete:     ${duplicates.join(", ")}` +
        `\n         new title:  ${summary}` +
        `\n         new span:   ${g.lesson_start}–${g.lesson_end}\n`
    );
  }

  for (const g of noGcal) {
    console.log(
      `[SKIP]   ${g.date} ${g.lesson_start}–${g.lesson_end} | ${g.student_name} — NO_GCAL (past event, skipped)\n`
    );
  }

  if (DRY_RUN) {
    log("Dry-run complete. Re-run without DRY_RUN=true to apply.");
    process.exit(0);
  }

  // ── Apply ───────────────────────────────────────────────────────────────────
  console.log("\n=== APPLYING CHANGES ===\n");

  // Dedup: if the same gcal_event_id appears in multiple OK groups (e.g. two
  // non-consecutive 30-min slots that both point to the same calendar event),
  // we must only PATCH it once.  We keep whichever group has the earliest
  // lesson_start and latest lesson_end so the span is as wide as possible.
  const dedupedOk = new Map<string, LessonGroup>();
  const duplicateGcalIds: string[] = [];

  for (const g of ok) {
    const id = g.gcal_ids[0]!;
    const existing = dedupedOk.get(id);
    if (!existing) {
      dedupedOk.set(id, g);
    } else {
      duplicateGcalIds.push(id);
      // Merge spans: take the earliest start and latest end.
      const mergedStart = existing.lesson_start < g.lesson_start ? existing.lesson_start : g.lesson_start;
      const mergedEnd   = existing.lesson_end   > g.lesson_end   ? existing.lesson_end   : g.lesson_end;
      dedupedOk.set(id, { ...existing, lesson_start: mergedStart, lesson_end: mergedEnd });
      log(`DEDUP: gcal_event_id ${id} appears in multiple groups — merging span to ${mergedStart}–${mergedEnd}`);
    }
  }

  if (duplicateGcalIds.length > 0) {
    log(`Found ${duplicateGcalIds.length} duplicate gcal_event_id(s): ${duplicateGcalIds.join(", ")}`);
  }

  const groupsToUpdate = [...dedupedOk.values(), ...needsMerge];

  let updated = 0;
  let merged = 0;
  let deleted = 0;
  const errors: string[] = [];

  for (const g of groupsToUpdate) {
    if (!teachersWithTokens.has(g.teacher_id)) {
      log(`WARN: no GCal token for teacher ${g.teacher_id} — skipping group ${g.date} ${g.lesson_start}`);
      continue;
    }

    const primary = g.gcal_ids[0]!;
    const duplicates = g.gcal_ids.slice(1);
    const { summary, description } = buildTitle(g);

    // 1. Update primary event title/description/span
    const ok_update = await updateCalendarEvent(g.teacher_id, primary, {
      summary,
      description,
      date: g.date,
      start_time: g.lesson_start,
      end_time: g.lesson_end,
    });

    if (ok_update) {
      log(`✓ Updated ${primary} → "${summary}" (${g.date} ${g.lesson_start}–${g.lesson_end})`);
      updated++;
    } else {
      errors.push(`Failed to update ${primary}`);
    }

    // 2. Delete duplicate events
    for (const dupId of duplicates) {
      await deleteCalendarEvent(g.teacher_id, dupId);
      log(`✓ Deleted duplicate event ${dupId}`);
      deleted++;
    }

    // 3. Update all slots in the group to point to primary gcal_event_id
    if (duplicates.length > 0) {
      const slotIds = g.slots.map((s) => s.id);
      await db
        .update(lessonBookings)
        .set({ gcal_event_id: primary, updated_at: new Date() })
        .where(inArray(lessonBookings.id, slotIds));
      log(`✓ DB: ${slotIds.length} slots → gcal_event_id=${primary}`);
      merged++;
    }
  }

  // ── Verification ─────────────────────────────────────────────────────────
  console.log("\n=== VERIFICATION ===\n");

  const finalBookings = await fetchApprovedBookings();
  const finalGroups = buildGroups(finalBookings);

  const stillNeedsMerge = finalGroups.filter((g) => g.status === "NEEDS_MERGE");
  const stillNoGcal = finalGroups.filter((g) => g.status === "NO_GCAL");
  const nowOk = finalGroups.filter((g) => g.status === "OK");

  log(`Groups verified OK: ${nowOk.length}`);
  log(`Groups still NEEDS_MERGE: ${stillNeedsMerge.length}`);
  log(`Groups still NO_GCAL: ${stillNoGcal.length} (expected — past events skipped)`);

  if (stillNeedsMerge.length > 0) {
    log("ERROR: Some groups still have multiple gcal_event_ids!");
    for (const g of stillNeedsMerge) {
      log(`  ${g.date} ${g.lesson_start}–${g.lesson_end} | ${g.student_name} | ids: ${g.gcal_ids.join(", ")}`);
    }
  }

  // ── Final report ────────────────────────────────────────────────────────
  console.log("\n=== RESULTS ===");
  log(`Events updated (title/span): ${updated}`);
  log(`Duplicate events deleted:    ${deleted}`);
  log(`Groups merged in DB:         ${merged}`);
  log(`Groups skipped (NO_GCAL):    ${noGcal.length}`);
  if (errors.length > 0) {
    log(`Errors: ${errors.join("; ")}`);
    process.exit(1);
  }
  log("Done ✓");
}

main().catch((err) => {
  console.error("[fix-gcal-events] Fatal:", err);
  process.exit(1);
});
