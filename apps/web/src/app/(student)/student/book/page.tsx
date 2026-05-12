"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Calendar, type TimeSlot } from "@/components/calendar/calendar";
import { Send, X, Clock } from "lucide-react";
import { groupConsecutiveBookings, type BookingLike } from "@/lib/booking-grouping";

// Compute minutes between two "HH:mm" strings.
function slotMinutes(startTime: string, endTime: string): number {
  const [sh = 0, sm = 0] = startTime.split(":").map(Number);
  const [eh = 0, em = 0] = endTime.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

interface Slot extends TimeSlot {
  date: string;
}

interface Booking {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  student_note: string | null;
  teacher_note: string | null;
  created_at: string;
}

// All supported lesson durations in minutes (each unit = one 30-min slot).
const DURATIONS = [60, 90, 120, 150, 180] as const;
type Duration = (typeof DURATIONS)[number];

function timeToMin(t: string): number {
  const [h = 0, m = 0] = t.split(":").map(Number);
  return h * 60 + m;
}

function addMinutes(t: string, mins: number): string {
  const total = timeToMin(t) + mins;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function formatDate(s: string): string {
  return new Date(s + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Try to build a chain of consecutive 30-min slots starting at `startTime`
 * that covers `durationMin` minutes in total.
 * Returns the ordered chain, or null if any gap is found.
 */
function buildLessonChain(
  startTime: string,
  durationMin: number,
  slots: Slot[]
): Slot[] | null {
  const numSlots = durationMin / 30;
  let cursor = startTime;
  const chain: Slot[] = [];
  for (let i = 0; i < numSlots; i++) {
    const slot = slots.find((s) => s.start_time === cursor);
    if (!slot) return null;
    chain.push(slot);
    cursor = slot.end_time;
  }
  return chain;
}

export default function StudentBookPage() {
  const t = useT();
  const qc = useQueryClient();

  const [selectedDate, setSelectedDate] = useState<string | undefined>();
  const [selectedStartTime, setSelectedStartTime] = useState<string | undefined>();
  const [duration, setDuration] = useState<Duration>(60);
  const [note, setNote] = useState("");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: slots = [], isLoading: slotsLoading } = useQuery<Slot[]>({
    queryKey: ["booking-slots"],
    queryFn: () => api.get("/bookings/available-slots"),
  });

  const { data: bookings = [], isLoading: bookingsLoading } = useQuery<Booking[]>({
    queryKey: ["my-bookings"],
    queryFn: () => api.get("/bookings/my"),
  });

  const activeDates = useMemo(
    () => new Set(slots.map((s) => s.date)),
    [slots]
  );

  // All 30-min slots on the selected date, sorted by start time.
  const slotsForDate = useMemo(
    () =>
      selectedDate
        ? slots
            .filter((s) => s.date === selectedDate)
            .sort((a, b) => a.start_time.localeCompare(b.start_time))
        : [],
    [slots, selectedDate]
  );

  // For each slot on the selected date, determine whether it can start a lesson
  // of the currently chosen duration (i.e. enough consecutive slots follow it).
  const startTimeOptions = useMemo(
    () =>
      slotsForDate.map((slot) => ({
        slot,
        chain: buildLessonChain(slot.start_time, duration, slotsForDate),
      })),
    [slotsForDate, duration]
  );

  // The consecutive chain backing the current (startTime, duration) selection.
  const selectedChain = useMemo(
    () =>
      selectedStartTime
        ? buildLessonChain(selectedStartTime, duration, slotsForDate)
        : null,
    [selectedStartTime, duration, slotsForDate]
  );

  const lessonEndTime = selectedStartTime
    ? addMinutes(selectedStartTime, duration)
    : undefined;

  // Group student's own bookings into consecutive lessons for display.
  const groupedBookings = useMemo(() => {
    const augmented: BookingLike[] = bookings.map((b) => ({
      ...b,
      student_id: "self",
      student_name: "",
      teacher_note: b.teacher_note,
    }));
    return groupConsecutiveBookings(augmented);
  }, [bookings]);

  const pending = groupedBookings.filter((g) => g.status === "pending");
  const approved = groupedBookings.filter(
    (g) => g.status === "approved" || g.status === "cancel_requested"
  );
  const past = groupedBookings.filter(
    (g) => g.status === "rejected" || g.status === "cancelled"
  );

  // ── Mutations ─────────────────────────────────────────────────────────────

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!selectedChain || selectedChain.length === 0) {
        throw new Error(t("booking.noSlotsForDate"));
      }
      await api.post("/bookings/batch", {
        availability_ids: selectedChain.map((s) => s.id),
        note: note || undefined,
      });
    },
    onSuccess: () => {
      setSuccess(true);
      setSelectedStartTime(undefined);
      setNote("");
      setError(null);
      qc.invalidateQueries({ queryKey: ["booking-slots"] });
      qc.invalidateQueries({ queryKey: ["my-bookings"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/bookings/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-bookings"] });
      qc.invalidateQueries({ queryKey: ["booking-slots"] });
    },
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function handleSelectDate(d: string) {
    setSelectedDate(d);
    setSelectedStartTime(undefined);
    setError(null);
    setSuccess(false);
  }

  function handleChangeDuration(d: Duration) {
    setDuration(d);
    setSelectedStartTime(undefined); // start time may no longer be valid
    setError(null);
  }

  function handleSelectStartTime(st: string) {
    setSelectedStartTime(st);
    setError(null);
    setSuccess(false);
  }

  // ── Duration labels ───────────────────────────────────────────────────────
  // Returns "שעה / 1.5 שעות / שעתיים …" for Hebrew, "1h / 1.5h …" for English.
  // We derive this from approvals.hoursCount which already handles floats.
  function durationLabel(mins: number): string {
    return t("approvals.hoursCount", { count: mins / 60 });
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (slotsLoading || bookingsLoading) {
    return <p className="text-gray-500">{t("common.loading")}</p>;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">
        {t("student.bookLesson")}
      </h1>

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
          {t("booking.requestSent")}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Calendar + Lesson picker */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Calendar */}
        <Card>
          <Calendar
            activeDates={activeDates}
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
          />
          <p className="text-xs text-gray-400 text-center mt-3">
            {t("booking.pickDateFirst")}
          </p>
        </Card>

        {/* Right: Duration + Start time */}
        <Card>
          {!selectedDate ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <Clock size={28} className="text-gray-300 mb-3" />
              <p className="text-sm text-gray-400">{t("booking.pickDateFirst")}</p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Duration selector */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
                  {t("booking.duration")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {DURATIONS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => handleChangeDuration(d)}
                      className={
                        duration === d
                          ? "px-4 py-1.5 rounded-full text-sm font-semibold bg-brand-600 text-white shadow-sm"
                          : "px-4 py-1.5 rounded-full text-sm font-medium border border-gray-200 text-gray-600 hover:border-brand-300 hover:text-brand-700 transition-colors"
                      }
                    >
                      {durationLabel(d)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Start time picker */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
                  {t("booking.startTime")}
                </p>

                {startTimeOptions.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">
                    {t("booking.noSlotsForDate")}
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {startTimeOptions.map(({ slot, chain }) => {
                      const disabled = chain === null;
                      const selected = selectedStartTime === slot.start_time;
                      return (
                        <button
                          key={slot.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => handleSelectStartTime(slot.start_time)}
                          className={
                            disabled
                              ? "py-2.5 rounded-lg text-sm text-gray-300 border border-gray-100 cursor-not-allowed select-none"
                              : selected
                                ? "py-2.5 rounded-lg text-sm font-semibold bg-brand-600 text-white border border-brand-600 shadow-sm"
                                : "py-2.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 hover:border-brand-300 hover:bg-brand-50 transition-colors"
                          }
                        >
                          {slot.start_time}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Warning when all start times are greyed out for this duration */}
                {startTimeOptions.length > 0 &&
                  startTimeOptions.every(({ chain }) => chain === null) && (
                    <p className="text-xs text-amber-600 mt-2">
                      {t("booking.noSlotsForDuration", { min: duration })}
                    </p>
                  )}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Summary + submit (only when a full lesson is selected) */}
      {selectedStartTime && selectedChain && lessonEndTime && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">
              {t("booking.lessonSummary")}
            </h3>
            <button
              type="button"
              onClick={() => {
                setSelectedStartTime(undefined);
                setNote("");
                setError(null);
              }}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              {t("booking.clearAll")}
            </button>
          </div>

          {/* Lesson pill */}
          <div className="mb-4">
            <span className="inline-flex items-center gap-2 bg-brand-50 border border-brand-200 text-brand-800 rounded-lg px-4 py-2.5 text-sm font-medium">
              <Clock size={14} className="text-brand-500 flex-shrink-0" />
              <span className="font-medium">{formatDate(selectedDate!)}</span>
              <span className="text-brand-300">·</span>
              <span className="font-mono font-semibold">
                {selectedStartTime}–{lessonEndTime}
              </span>
              <span className="text-brand-300">·</span>
              <span className="font-semibold">{durationLabel(duration)}</span>
            </span>
          </div>

          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("student.addNote")}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />

          <button
            type="button"
            onClick={() => submitMutation.mutate()}
            disabled={submitMutation.isPending}
            className="w-full flex items-center justify-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={14} />
            {submitMutation.isPending
              ? t("student.sending")
              : t("booking.sendRequest")}
          </button>
        </Card>
      )}

      {/* My bookings */}
      <Card>
        <h2 className="text-lg font-semibold text-gray-700 mb-4">
          {t("student.myBookings")}
        </h2>

        {bookings.length === 0 ? (
          <p className="text-sm text-gray-400">{t("student.noBookings")}</p>
        ) : (
          <div className="space-y-2">
            {[...pending, ...approved, ...past].map((g) => (
              <div
                key={g.key}
                className={
                  g.status === "pending"
                    ? "border border-orange-200 bg-orange-50 rounded-lg p-3 flex items-center justify-between"
                    : g.status === "approved"
                      ? "border border-green-200 bg-green-50 rounded-lg p-3 flex items-center justify-between"
                      : "border border-gray-100 rounded-lg p-3 flex items-center justify-between opacity-60"
                }
              >
                <div>
                  <p className="font-medium text-gray-800">
                    {formatDate(g.date)} · {g.start_time}–{g.end_time}
                    {g.hours > 0.5 && (
                      <span className="ms-2 text-xs text-gray-500">
                        ({t("approvals.hoursCount", { count: g.hours })})
                      </span>
                    )}
                  </p>
                  <span
                    className={
                      g.status === "pending"
                        ? "text-xs text-orange-600"
                        : g.status === "approved"
                          ? "text-xs text-green-700"
                          : g.status === "cancel_requested"
                            ? "text-xs text-red-600"
                            : "text-xs text-gray-500"
                    }
                  >
                    {t(`booking.${g.status}`)}
                  </span>
                  {g.teacher_note && (
                    <p className="text-xs text-gray-500 mt-1 italic">
                      &ldquo;{g.teacher_note}&rdquo;
                    </p>
                  )}
                </div>
                {(g.status === "pending" || g.status === "approved") && (
                  <button
                    onClick={() =>
                      Promise.all(g.ids.map((id) => cancelMutation.mutateAsync(id)))
                    }
                    disabled={cancelMutation.isPending}
                    className="text-sm text-red-500 hover:text-red-700 flex items-center gap-1"
                  >
                    <X size={14} />
                    {t("student.cancelBooking")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
