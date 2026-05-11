"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Calendar, TimeSlotGrid, type TimeSlot } from "@/components/calendar/calendar";
import { Send, X } from "lucide-react";
import { groupConsecutiveBookings, type BookingLike } from "@/lib/booking-grouping";

// Compute minutes between two "HH:mm" strings.
function slotMinutes(startTime: string, endTime: string): number {
  const [sh = 0, sm = 0] = startTime.split(":").map(Number);
  const [eh = 0, em = 0] = endTime.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

// Find N consecutive slots starting from startSlot for the given duration.
// Returns the slots in order, or null if not enough consecutive slots exist.
function findConsecutiveSlotsForDuration(
  startSlot: Slot,
  durationMinutes: number,
  allSlots: Slot[]
): Slot[] | null {
  const slotsNeeded = durationMinutes / 30;
  if (slotsNeeded < 1) return null;

  const result: Slot[] = [startSlot];
  let currentEndTime = startSlot.end_time;

  for (let i = 1; i < slotsNeeded; i++) {
    const next = allSlots.find(
      (s) => s.date === startSlot.date && s.start_time === currentEndTime
    );
    if (!next) return null; // Gap or end of day reached
    result.push(next);
    currentEndTime = next.end_time;
  }

  return result;
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

function formatDate(s: string): string {
  const d = new Date(s + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function StudentBookPage() {
  const t = useT();
  const qc = useQueryClient();

  const [selectedDate, setSelectedDate] = useState<string | undefined>();
  const [selectedStartSlot, setSelectedStartSlot] = useState<Slot | null>(null);
  const [selectedDuration, setSelectedDuration] = useState(60);
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

  const slotsForSelectedDate = useMemo(
    () =>
      selectedDate
        ? slots
            .filter((s) => s.date === selectedDate)
            .sort((a, b) => a.start_time.localeCompare(b.start_time))
        : [],
    [slots, selectedDate]
  );

  // Calculate which consecutive slots are needed for the selected duration.
  const calculatedSlots = useMemo(() => {
    if (!selectedStartSlot) return null;
    return findConsecutiveSlotsForDuration(
      selectedStartSlot,
      selectedDuration,
      slotsForSelectedDate
    );
  }, [selectedStartSlot, selectedDuration, slotsForSelectedDate]);

  // Error if not enough consecutive slots available.
  const calculatedSlotsError = useMemo(() => {
    if (!selectedStartSlot) return null;
    if (calculatedSlots === null) {
      const durationHours = selectedDuration / 60;
      return `Not enough consecutive slots available for ${durationHours}h starting at ${selectedStartSlot.start_time}`;
    }
    return null;
  }, [selectedStartSlot, selectedDuration, calculatedSlots]);

  function selectStartSlot(slot: Slot) {
    setSuccess(false);
    setError(null);
    setSelectedStartSlot(slot);
  }

  function onDurationChange(duration: number) {
    setSuccess(false);
    setError(null);
    setSelectedDuration(duration);
  }

  function clearAll() {
    setSelectedStartSlot(null);
    setSelectedDuration(60);
    setNote("");
    setError(null);
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!calculatedSlots || calculatedSlots.length === 0) {
        throw new Error("Please select a start time and duration.");
      }

      await api.post("/bookings", {
        availability_ids: calculatedSlots.map((s) => s.id),
        note: note || undefined,
      });
    },
    onSuccess: () => {
      setSuccess(true);
      clearAll();
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

  // Group consecutive bookings (e.g. 11:30+12:30 → "11:30–13:30").
  // The student's own bookings don't carry student_id/name, so synthesize
  // constants — all rows belong to the same student by definition.
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

  if (slotsLoading || bookingsLoading) {
    return <p className="text-gray-500">{t("common.loading")}</p>;
  }

  // Format duration as string (e.g. "1h", "1.5h")
  const durationStr =
    selectedDuration < 60
      ? `${selectedDuration}m`
      : selectedDuration % 60 === 0
        ? `${selectedDuration / 60}h`
        : `${Math.floor(selectedDuration / 60)}.5h`;

  const endTime = calculatedSlots ? calculatedSlots[calculatedSlots.length - 1]?.end_time : null;

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


      {/* Calendar + Time picker */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <Calendar
            activeDates={activeDates}
            selectedDate={selectedDate}
            onSelectDate={(d) => setSelectedDate(d)}
          />
          <p className="text-xs text-gray-400 text-center mt-3">
            {t("booking.calendarHint")}
          </p>
        </Card>

        <Card>
          {!selectedDate ? (
            <div className="text-center text-sm text-gray-400 py-12">
              {t("booking.pickDateFirst")}
            </div>
          ) : (
            <>
              <TimeSlotGrid
                date={selectedDate}
                slots={slotsForSelectedDate}
                selectedSlotIds={selectedStartSlot ? new Set([selectedStartSlot.id]) : new Set()}
                onSelectSlot={(s) => selectStartSlot(s as Slot)}
              />
            </>
          )}
        </Card>
      </div>

      {/* Duration selector + submission */}
      {selectedStartSlot && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">Choose lesson duration</h3>
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              {t("booking.clearAll")}
            </button>
          </div>

          {/* Duration selection */}
          <div className="space-y-2 mb-4">
            {[60, 90, 120, 150, 180].map((duration) => (
              <label key={duration} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                <input
                  type="radio"
                  name="duration"
                  value={duration}
                  checked={selectedDuration === duration}
                  onChange={() => onDurationChange(duration)}
                  className="w-4 h-4 text-brand-600"
                />
                <span className="text-sm text-gray-700">
                  {duration} minutes {duration % 60 === 0 ? `(${duration / 60}h)` : `(${Math.floor(duration / 60)}.5h)`}
                </span>
              </label>
            ))}
          </div>

          {/* Display selected time */}
          {calculatedSlots && endTime && (
            <div className="bg-brand-50 border border-brand-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-gray-700">
                <span className="font-semibold">{formatDate(selectedStartSlot.date)}</span>
                <span className="text-gray-500 mx-2">·</span>
                <span className="font-mono text-brand-700">
                  {selectedStartSlot.start_time}–{endTime}
                </span>
                <span className="text-gray-500 mx-2">·</span>
                <span className="text-brand-700 font-medium">{durationStr}</span>
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {calculatedSlots.length} slots
              </p>
            </div>
          )}

          {/* Error message */}
          {calculatedSlotsError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
              {calculatedSlotsError}
            </div>
          )}

          {/* Student note */}
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("student.addNote")}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />

          {/* Submit button */}
          <button
            type="button"
            onClick={() => submitMutation.mutate()}
            disabled={submitMutation.isPending || !calculatedSlots}
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
                    {g.hours > 1 && (
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
