/**
 * Groups consecutive booking slots into single visual rows.
 *
 * Two slots are "consecutive" when they belong to the same student, fall on
 * the same date, share status, and the end_time of one equals the start_time
 * of the next. Anything else (different day, gap, different status, different
 * student) starts a new group.
 *
 * Used by the approvals page and the teacher schedule's "upcoming lessons"
 * section so that a 90-min booking shows as "11:30–13:00 · דני (1.5h)" rather
 * than three stacked 30-min rows.
 */

function timeToMin(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Maps an hours value to an i18n translation key.
 * Covers the five standard lesson durations (60 / 90 / 120 / 150 / 180 min).
 */
const DURATION_KEY_MAP: Record<number, string> = {
  1: "teacher.duration60",
  1.5: "teacher.duration90",
  2: "teacher.duration120",
  2.5: "teacher.duration150",
  3: "teacher.duration180",
};

/**
 * Returns a localised duration label using the app's translation function.
 * Accepts the `hours` field already present on a `BookingGroup`.
 * Falls back to `${hours}h` for non-standard values.
 */
export function formatDurationI18n(
  hours: number,
  t: (key: string) => string
): string {
  const key = DURATION_KEY_MAP[hours];
  return key ? t(key) : `${hours}h`;
}

/**
 * @deprecated Use formatDurationI18n instead.
 * Formats a duration as a compact string: "30m", "1h", "1.5h", "2h", etc.
 */
export function formatDuration(startTime: string, endTime: string): string {
  const mins = timeToMin(endTime) - timeToMin(startTime);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${h}h` : `${h}.5h`;
}

export interface BookingLike {
  id: string;
  student_id: string;
  student_name: string;
  date: string;
  start_time: string; // "HH:mm"
  end_time: string; // "HH:mm"
  status: string;
  student_note: string | null;
  teacher_note?: string | null;
  /** Whether the lesson actually took place. Null until teacher marks it. */
  attendance?: "attended" | "no_show" | null;
  created_at: string;
  /** Course this lesson is associated with. Null for legacy lessons. */
  course_id?: string | null;
  /**
   * Google Calendar event id. All slots created by a single teacher action
   * share one gcal_event_id; two back-to-back lessons created separately have
   * different ids. Used as the primary group key so distinct lessons never
   * collapse into one row (which would also hide the correct course_id and
   * produce non-standard durations like "3.5h").
   * Null on legacy lessons or before GCal sync; grouping falls back to
   * (student_id + date + consecutive-time + course_id) in that case.
   */
  gcal_event_id?: string | null;
  /**
   * Calendar background-sync status (Phase 3B-2). Surfaced on teacher
   * lessons whose Google Calendar event is processed off-request:
   *   'not_required' | 'synced' → no badge
   *   'pending'                 → "מסתנכרן ליומן…"
   *   'failed'                  → "סנכרון ליומן נכשל"
   * All rows in a group share the same value.
   */
  calendar_sync_status?: "not_required" | "pending" | "synced" | "failed";
}

export interface BookingGroup<T extends BookingLike = BookingLike> {
  /** Stable key for React. */
  key: string;
  /** All booking IDs that belong to this group. */
  ids: string[];
  student_id: string;
  student_name: string;
  date: string;
  start_time: string; // earliest start in group
  end_time: string; // latest end in group
  status: string;
  student_note: string | null;
  teacher_note: string | null;
  bookings: T[];
  /**
   * Actual lesson duration in hours (float).
   * 30 min = 0.5, 1 hour = 1.0, 90 min = 1.5, 2 hours = 2.0, etc.
   * Derived from start_time..end_time of the full group, NOT bookings.length.
   */
  hours: number;
  /** Course this lesson group is associated with. Null for legacy lessons. */
  course_id?: string | null;
  /** GCal event id shared by every slot in this group. Null for legacy. */
  gcal_event_id?: string | null;
}

export function groupConsecutiveBookings<T extends BookingLike>(
  bookings: T[]
): BookingGroup<T>[] {
  const sorted = [...bookings].sort((a, b) =>
    a.date === b.date
      ? a.start_time.localeCompare(b.start_time)
      : a.date.localeCompare(b.date)
  );

  const groups: BookingGroup<T>[] = [];
  for (const b of sorted) {
    const last = groups[groups.length - 1];
    // Two slots are part of the same lesson only when:
    //   - same student + same date + same status + back-to-back times AND
    //   - same gcal_event_id (or both null — legacy) AND
    //   - same course_id (or both null — legacy)
    // The gcal/course gates prevent two distinct lessons (e.g., Math 10–11
    // then Algebra 11–12) from collapsing into one "3.5h" row whose course_id
    // would silently reflect only the first slot.
    const isConsecutive =
      !!last &&
      last.student_id === b.student_id &&
      last.date === b.date &&
      last.end_time === b.start_time &&
      last.status === b.status &&
      (last.gcal_event_id ?? null) === (b.gcal_event_id ?? null) &&
      (last.course_id ?? null) === (b.course_id ?? null);

    if (isConsecutive) {
      last.ids.push(b.id);
      last.bookings.push(b);
      last.end_time = b.end_time;
      // Recompute actual duration (minutes → hours) from the full span.
      last.hours = (timeToMin(b.end_time) - timeToMin(last.start_time)) / 60;
      if (b.teacher_note) last.teacher_note = b.teacher_note;
    } else {
      groups.push({
        // gcal_event_id is appended (when present) so two same-time-same-student
        // groups get unique React keys even before the consecutive check splits
        // them (defensive — gcal_event_id is already in the consecutive check).
        key: `${b.student_id}|${b.date}|${b.start_time}|${b.status}|${b.gcal_event_id ?? ""}`,
        ids: [b.id],
        student_id: b.student_id,
        student_name: b.student_name,
        date: b.date,
        start_time: b.start_time,
        end_time: b.end_time,
        status: b.status,
        student_note: b.student_note,
        teacher_note: b.teacher_note ?? null,
        bookings: [b],
        hours: (timeToMin(b.end_time) - timeToMin(b.start_time)) / 60,
        course_id: b.course_id ?? null,
        gcal_event_id: b.gcal_event_id ?? null,
      });
    }
  }
  return groups;
}
