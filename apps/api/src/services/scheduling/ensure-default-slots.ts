import { eq, and, gte, isNotNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import { teacherAvailability } from "../../db/schema.js";
import { getIsraelToday } from "../../lib/time.js";

/**
 * Default availability policy.
 *
 * Sunday–Thursday, 11:30–21:00, 1-hour slots.
 * Friday + Saturday are intentionally left out so the teacher can open them
 * manually on a per-date basis.
 */
const DEFAULT_DAYS = new Set([0, 1, 2, 3, 4]); // 0=Sun ... 4=Thu
const DEFAULT_START = "11:00";
const DEFAULT_END = "20:00";
const DEFAULT_SLOT_MINUTES = 60;
const WEEKS_AHEAD = 4;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${pad(h)}:${pad(m)}`;
}

/**
 * Make sure the teacher has default slots populated for the next `WEEKS_AHEAD`
 * weeks. Idempotent and *slot-scoped*: for each Sun–Thu date in the window,
 * the function adds only the default-grid hours that aren't already covered
 * by an existing slot (overlap check, active or inactive — so manually
 * deleted slots stay deleted).
 *
 * This is intentionally finer-grained than a date-level skip so that days
 * with one custom or booked slot still get the rest of the day filled in
 * with the standard 11:00–20:00 grid.
 *
 * Called lazily from the read paths (GET /availability and /available-slots)
 * so new teachers and rolling time windows fill themselves without a cron.
 */
export async function ensureDefaultSlots(teacherId: string): Promise<void> {
  // Anchor the window on Israel's "today" so we don't generate yesterday's
  // slots (or skip today's) at the UTC↔Israel midnight boundary.
  const todayStr = getIsraelToday();
  const today = new Date(todayStr + "T00:00:00");

  const horizon = new Date(today);
  horizon.setDate(today.getDate() + 7 * WEEKS_AHEAD);

  // Pull every existing slot (active or inactive) in the window — any of them
  // blocks the matching default grid slot via overlap, so teacher edits stick.
  const rows = await db
    .select({
      date: teacherAvailability.date,
      start_time: teacherAvailability.start_time,
      end_time: teacherAvailability.end_time,
    })
    .from(teacherAvailability)
    .where(
      and(
        eq(teacherAvailability.teacher_id, teacherId),
        isNotNull(teacherAvailability.date),
        gte(teacherAvailability.date, todayStr)
      )
    );

  const existingByDate = new Map<string, Array<{ start: string; end: string }>>();
  for (const r of rows) {
    if (!r.date) continue;
    if (!existingByDate.has(r.date)) existingByDate.set(r.date, []);
    existingByDate.get(r.date)!.push({ start: r.start_time, end: r.end_time });
  }

  const startMin = timeToMin(DEFAULT_START);
  const endMin = timeToMin(DEFAULT_END);

  type NewSlot = {
    teacher_id: string;
    date: string;
    start_time: string;
    end_time: string;
  };
  const toCreate: NewSlot[] = [];

  for (
    const cursor = new Date(today);
    cursor <= horizon;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    if (!DEFAULT_DAYS.has(cursor.getDay())) continue;
    const dateStr = ymd(cursor);
    const existing = existingByDate.get(dateStr) ?? [];

    let t = startMin;
    while (t + DEFAULT_SLOT_MINUTES <= endMin) {
      const slotStart = minToTime(t);
      const slotEnd = minToTime(t + DEFAULT_SLOT_MINUTES);
      // [a, b) overlaps [c, d) iff a < d and c < b
      const overlaps = existing.some(
        (e) => e.start < slotEnd && e.end > slotStart
      );
      if (!overlaps) {
        toCreate.push({
          teacher_id: teacherId,
          date: dateStr,
          start_time: slotStart,
          end_time: slotEnd,
        });
      }
      t += DEFAULT_SLOT_MINUTES;
    }
  }

  if (toCreate.length === 0) return;
  await db.insert(teacherAvailability).values(toCreate);
}
