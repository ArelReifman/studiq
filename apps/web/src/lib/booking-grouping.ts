/**
 * Groups consecutive booking slots into single visual rows.
 *
 * Two slots are "consecutive" when they belong to the same student, fall on
 * the same date, share status, and the end_time of one equals the start_time
 * of the next. Anything else (different day, gap, different status, different
 * student) starts a new group.
 *
 * Used by the approvals page and the teacher schedule's "upcoming lessons"
 * section so that a 2-hour booking shows as "11:30–13:30 · דני (2h)" rather
 * than two stacked one-hour rows.
 */

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
  /** Number of one-hour blocks merged. Equivalent to bookings.length. */
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
      last.hours = last.bookings.length;
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
        hours: 1,
      });
    }
  }
  return groups;
}
