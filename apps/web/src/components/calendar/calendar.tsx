"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

const HEBREW_MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

const ENGLISH_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const HEBREW_DOW = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
const ENGLISH_DOW = ["S", "M", "T", "W", "T", "F", "S"];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayYmd(): string {
  return ymd(new Date());
}

export interface CalendarProps {
  /** ISO date strings (YYYY-MM-DD) that should be highlighted as having something */
  activeDates: Set<string>;
  /** Optional: dates that have a confirmed/approved booking — get a green dot */
  bookedDates?: Set<string>;
  /** Currently selected date (YYYY-MM-DD) */
  selectedDate?: string;
  onSelectDate: (date: string) => void;
  /** When true, past dates are clickable too (for teacher view of past). Default: false. */
  allowPast?: boolean;
  /** Locale: "he" (default) or "en". When "he" the calendar is RTL (Sat-rightmost). */
  locale?: "he" | "en";
}

export function Calendar({
  activeDates,
  bookedDates,
  selectedDate,
  onSelectDate,
  allowPast = false,
  locale = "he",
}: CalendarProps) {
  const today = todayYmd();
  const [cursor, setCursor] = useState<Date>(() => {
    const d = selectedDate ? new Date(selectedDate + "T00:00:00") : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const months = locale === "he" ? HEBREW_MONTHS : ENGLISH_MONTHS;
  const dow = locale === "he" ? HEBREW_DOW : ENGLISH_DOW;

  const cells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const out: { date: string | null; day: number | null }[] = [];
    for (let i = 0; i < firstDay; i++) out.push({ date: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${pad(month + 1)}-${pad(d)}`;
      out.push({ date, day: d });
    }
    while (out.length % 7 !== 0) out.push({ date: null, day: null });
    return out;
  }, [cursor]);

  function shiftMonth(delta: number) {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => shiftMonth(-1)}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft size={18} className="rtl:rotate-180" />
        </button>
        <div className="font-semibold text-gray-800">
          {months[cursor.getMonth()]} {cursor.getFullYear()}
        </div>
        <button
          onClick={() => shiftMonth(1)}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          aria-label="Next month"
        >
          <ChevronRight size={18} className="rtl:rotate-180" />
        </button>
      </div>

      {/* Day-of-week header */}
      <div
        className={cn(
          "grid grid-cols-7 gap-1 mb-2 text-xs font-semibold text-gray-500",
          locale === "he" ? "rtl" : "ltr"
        )}
      >
        {dow.map((d, i) => (
          <div key={i} className="text-center py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Cells */}
      <div
        className={cn(
          "grid grid-cols-7 gap-1",
          locale === "he" ? "rtl" : "ltr"
        )}
      >
        {cells.map((c, i) => {
          if (!c.date) {
            return <div key={i} className="aspect-square" />;
          }
          const isPast = !allowPast && c.date < today;
          const isToday = c.date === today;
          const isSelected = c.date === selectedDate;
          const isActive = activeDates.has(c.date);
          const isBooked = bookedDates?.has(c.date) ?? false;
          const clickable = !isPast;

          return (
            <button
              key={i}
              type="button"
              onClick={() => clickable && onSelectDate(c.date!)}
              disabled={!clickable}
              className={cn(
                "relative aspect-square flex items-center justify-center rounded-full text-sm font-medium transition-all",
                isSelected && "bg-brand-600 text-white shadow-md",
                !isSelected && isActive && "bg-brand-50 text-brand-700 hover:bg-brand-100",
                !isSelected && !isActive && !isPast && "text-gray-700 hover:bg-gray-100",
                isPast && "text-gray-300 cursor-not-allowed",
                isToday && !isSelected && "ring-1 ring-brand-300"
              )}
            >
              {c.day}
              {isBooked && (
                <span
                  className={cn(
                    "absolute bottom-1 w-1.5 h-1.5 rounded-full",
                    isSelected ? "bg-white" : "bg-green-500"
                  )}
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

export interface TimeSlot {
  id: string;
  start_time: string;
  end_time: string;
}

export interface TimeSlotGridProps {
  date: string;
  slots: TimeSlot[];
  /** Set of slot IDs currently selected (multi-select). */
  selectedSlotIds?: Set<string>;
  onSelectSlot: (slot: TimeSlot) => void;
  /** Optional remove handler — if provided, each slot shows an X. */
  onRemoveSlot?: (slot: TimeSlot) => void;
  emptyLabel?: string;
}

export function TimeSlotGrid({
  date,
  slots,
  selectedSlotIds,
  onSelectSlot,
  onRemoveSlot,
  emptyLabel,
}: TimeSlotGridProps) {
  const t = useT();
  const formatted = formatDateLabel(date);

  return (
    <div>
      <div className="text-center mb-4">
        <h3 className="font-semibold text-gray-800">{formatted}</h3>
        <p className="text-sm text-gray-500 mt-0.5">{t("booking.pickTime")}</p>
      </div>

      {slots.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-6">
          {emptyLabel ?? t("booking.noSlotsForDate")}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {slots.map((slot) => (
            <div key={slot.id} className="relative">
              <button
                type="button"
                onClick={() => onSelectSlot(slot)}
                className={cn(
                  "w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium border transition-all",
                  selectedSlotIds?.has(slot.id)
                    ? "bg-brand-600 text-white border-brand-600 shadow-md"
                    : "bg-white text-gray-700 border-gray-200 hover:border-brand-400 hover:bg-brand-50"
                )}
              >
                <Clock size={14} />
                {slot.start_time}
              </button>
              {onRemoveSlot && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveSlot(slot);
                  }}
                  className="absolute -top-1.5 -end-1.5 w-5 h-5 rounded-full bg-red-100 text-red-600 hover:bg-red-200 flex items-center justify-center text-xs font-bold transition-colors"
                  aria-label="Remove"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDateLabel(date: string): string {
  const d = new Date(date + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isToday = ymd(today) === date;
  const dd = pad(d.getDate());
  const mm = pad(d.getMonth() + 1);
  const yy = d.getFullYear();
  return isToday ? `${dd}/${mm}/${yy} (היום)` : `${dd}/${mm}/${yy}`;
}
