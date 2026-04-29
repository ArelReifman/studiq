/**
 * Israel timezone helpers.
 *
 * The server runs on UTC (Vercel) but the product is Israel-only. Using
 * `new Date().toISOString().split("T")[0]` for "today" silently breaks at the
 * UTC↔Israel midnight boundary (a slot at 23:00 Israel time on May 1 looks
 * like May 1 to a user but UTC is already May 2). All scheduling-related
 * code must use these helpers instead of raw `Date` math.
 */

const TZ = "Asia/Jerusalem";

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Today's date in Israel time, as a YYYY-MM-DD string.
 */
export function getIsraelToday(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/**
 * Current wall-clock time in Israel as HH:mm.
 */
export function getIsraelTimeHHMM(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = parts.find((p) => p.type === "hour")!.value;
  const m = parts.find((p) => p.type === "minute")!.value;
  // Intl can return "24:00" at the day boundary in some runtimes — normalize.
  const hh = h === "24" ? "00" : h;
  return `${hh}:${m}`;
}

/**
 * True if the given slot (date + start_time) is already in the past in
 * Israel time. Use this to hide today's already-passed slots from students.
 */
export function isSlotInPastIsrael(date: string, startTime: string): boolean {
  const today = getIsraelToday();
  if (date < today) return true;
  if (date > today) return false;
  return startTime <= getIsraelTimeHHMM();
}

// Re-export pad for callers building YYYY-MM-DD strings.
export { pad };
