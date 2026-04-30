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
 * weeks. Idempotent and date-scoped: any date that already has at least one
 * slot is skipped — that means manual deletions stick (the function never
 * re-creates a slot the teacher removed).
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

  // Pull every date in the window that already has any slot (active or not).
  // Even inactive rows count — a teacher who deleted a slot shouldn't see it
  // come back. Same for any explicit row they added manually.
  const rows = await db
    .select({ date: teacherAvailability.date })
    .from(teacherAvailability)
    .where(
      and(
        eq(teacherAvailability.teacher_id, teacherId),
        isNotNull(teacherAvailability.date),
        gte(teacherAvailability.date, todayStr)
      )
    );

  const seenDates = new Set(rows.map((r) => r.date).filter((d): d is string => !!d));

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
    if (seenDates.has(dateStr)) continue;

    let t = startMin;
    while (t + DEFAULT_SLOT_MINUTES <= endMin) {
      toCreate.push({
        teacher_id: teacherId,
        date: dateStr,
        start_time: minToTime(t),
        end_time: minToTime(t + DEFAULT_SLOT_MINUTES),
      });
      t += DEFAULT_SLOT_MINUTES;
    }
  }

  if (toCreate.length === 0) return;
  await db.insert(teacherAvailability).values(toCreate);
}
