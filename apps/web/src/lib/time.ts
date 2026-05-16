/**
 * Israel-timezone date helpers (client-side).
 *
 * The dashboard and schedule pages compare bookings by their `date` field
 * (YYYY-MM-DD, always interpreted as Israel local date by the API). The
 * previous implementation used `new Date().toISOString().slice(0, 10)`, which
 * returns the UTC date — so between 22:00 UTC (00:00 IL) and 21:59 UTC the
 * next day, "today" in UTC drifts to tomorrow in Israel for ~3 hours.
 *
 * These helpers mirror the server's `getIsraelToday()` in apps/api/src/lib/time.ts
 * and the inline `getIsraelNow()` in LessonFormModal.tsx — same Intl logic, no
 * external dependency, no schema change.
 */

const TZ = "Asia/Jerusalem";

/** Returns today's date in Israel as "YYYY-MM-DD". */
export function getIsraelToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/** Returns tomorrow's date in Israel as "YYYY-MM-DD". */
export function getIsraelTomorrow(): string {
  // Add one day to *today's IL date* (not to "now"), so DST transitions and
  // late-UTC hours don't accidentally produce the same day twice.
  const today = getIsraelToday();
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  // Use UTC arithmetic on a date built from IL Y/M/D — this only advances the
  // calendar day; we don't read it back as a wall-clock time.
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}
