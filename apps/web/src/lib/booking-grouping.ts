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
 * Formats a duration as a compact string: "30m", "1h", "1.5h", "2h", etc.
 * Works with any slot granularity (30-min or 60-min blocks).
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
    const isConsecutive =
      !!last &&
      last.student_id === b.student_id &&
      last.date === b.date &&
      last.end_time === b.start_time &&
      last.status === b.status;

    if (isConsecutive) {
      last.ids.push(b.id);
      last.bookings.push(b);
      last.end_time = b.end_time;
      // Recompute actual duration (minutes → hours) from the full span.
      last.hours = (timeToMin(b.end_time) - timeToMin(last.start_time)) / 60;
      if (b.teacher_note) last.teacher_note = b.teacher_note;
    } else {
      groups.push({
        key: `${b.student_id}|${b.date}|${b.start_time}|${b.status}`,
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
      });
    }
  }
  return groups;
}
