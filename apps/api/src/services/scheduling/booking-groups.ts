import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { lessonBookings } from "../../db/schema.js";

/**
 * Format a duration label from two HH:mm times.
 * Examples: "30m", "1h", "1.5h", "2h", "3h".
 *
 * Used for Telegram pings — a half-hour grid means a single "lesson request"
 * can span 30m, 1h, 1.5h, ... up to 3h.
 */
export function formatDurationLabel(start: string, end: string): string {
  const [sh = 0, sm = 0] = start.split(":").map(Number);
  const [eh = 0, em = 0] = end.split(":").map(Number);
  const min = eh * 60 + em - (sh * 60 + sm);
  if (min < 60) return `${min}m`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${Math.floor(min / 60)}.5h`;
}

export type BookingStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancel_requested"
  | "cancelled";

export interface GroupRow {
  id: string;
  start_time: string;
  end_time: string;
  gcal_event_id: string | null;
}

export interface ConsecutiveGroup {
  ids: string[];
  start_time: string;
  end_time: string;
  isHead: boolean;
  rows: GroupRow[];
}

/**
 * Find the consecutive group of bookings that share student + date + status,
 * contain `bookingId`, and were touched within the recent window.
 *
 * The frontend fires N parallel requests for N consecutive slots. We use a
 * 700ms in-request delay + a "recent activity" window to coalesce them: by
 * the time we run the read, all sibling rows have committed, so we can scan
 * them as a group. The "head of group" (earliest start_time) is responsible
 * for the external side-effect (Telegram ping, Google Calendar event); the
 * others stay silent.
 *
 * `timeColumn` controls whether we filter by `created_at` (new bookings) or
 * `updated_at` (status changes — cancels, approvals).
 */
export async function findConsecutiveGroup(opts: {
  bookingId: string;
  studentId: string;
  date: string;
  statuses: BookingStatus[];
  timeColumn: "created_at" | "updated_at";
  recentMs?: number;
  delayMs?: number;
}): Promise<ConsecutiveGroup | null> {
  const recentMs = opts.recentMs ?? 10_000;
  const delayMs = opts.delayMs ?? 700;

  // Wait for parallel siblings to commit. Vercel kills deferred work after
  // the response is sent, so this MUST happen inside the request.
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

  const cutoff = new Date(Date.now() - recentMs);
  const timeCol =
    opts.timeColumn === "created_at"
      ? lessonBookings.created_at
      : lessonBookings.updated_at;

  const rows = await db
    .select({
      id: lessonBookings.id,
      start_time: lessonBookings.start_time,
      end_time: lessonBookings.end_time,
      gcal_event_id: lessonBookings.gcal_event_id,
    })
    .from(lessonBookings)
    .where(
      and(
        eq(lessonBookings.student_id, opts.studentId),
        eq(lessonBookings.date, opts.date),
        inArray(lessonBookings.status, opts.statuses),
        gte(timeCol, cutoff)
      )
    )
    .orderBy(lessonBookings.start_time);

  const idx = rows.findIndex((r) => r.id === opts.bookingId);
  if (idx === -1) return null;

  let lo = idx;
  let hi = idx;
  while (lo > 0 && rows[lo - 1]!.end_time === rows[lo]!.start_time) lo--;
  while (
    hi < rows.length - 1 &&
    rows[hi]!.end_time === rows[hi + 1]!.start_time
  )
    hi++;

  const groupRows = rows.slice(lo, hi + 1);
  return {
    ids: groupRows.map((r) => r.id),
    start_time: groupRows[0]!.start_time,
    end_time: groupRows[groupRows.length - 1]!.end_time,
    isHead: groupRows[0]!.id === opts.bookingId,
    rows: groupRows,
  };
}
