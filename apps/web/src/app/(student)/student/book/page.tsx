"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Calendar, TimeSlotGrid, type TimeSlot } from "@/components/calendar/calendar";
import { Send, X, Plus } from "lucide-react";
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
  const [picked, setPicked] = useState<Slot[]>([]);
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

  const pickedIds = useMemo(() => new Set(picked.map((s) => s.id)), [picked]);

  // Find a slot adjacent to the latest pick — same date, start equals end of pick.
  const latestPicked = useMemo(() => {
    if (picked.length === 0) return null;
    return [...picked].sort((a, b) =>
      a.date === b.date
        ? a.start_time.localeCompare(b.start_time)
        : a.date.localeCompare(b.date)
    ).pop()!;
  }, [picked]);

  const adjacentSlot = useMemo(() => {
    if (!latestPicked) return null;
    return (
      slots.find(
        (s) =>
          s.date === latestPicked.date &&
          s.start_time === latestPicked.end_time &&
          !pickedIds.has(s.id)
      ) ?? null
    );
  }, [slots, latestPicked, pickedIds]);

  function toggleSlot(slot: Slot) {
    setSuccess(false);
    setError(null);
    const alreadyPicked = picked.find((s) => s.id === slot.id);
    // Removing is always allowed; adding is blocked once the per-submission
    // cap is reached.
    if (!alreadyPicked && atCap) {
      setError(t("booking.capReached"));
      return;
    }
    setPicked((prev) =>
      prev.find((s) => s.id === slot.id)
        ? prev.filter((s) => s.id !== slot.id)
        : [...prev, slot]
    );
  }

  function clearAll() {
    setPicked([]);
    setNote("");
    setError(null);
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      // Send all bookings in parallel — each is independent on the server side.
      const results = await Promise.allSettled(
        picked.map((s) =>
          api.post("/bookings", {
            availability_id: s.id,
            note: note || undefined,
          })
        )
      );
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        throw new Error(
          t("booking.partialFailure", { count: failures.length })
        );
      }
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

  // Selection cap: at most 3 hours (180 minutes) can be picked in one submission.
  // Slot count varies — could be 6 × 30-min, 3 × 60-min, or any mix.
  const MAX_MINUTES = 180;
  const totalMinutes = picked.reduce(
    (sum, s) => sum + slotMinutes(s.start_time, s.end_time),
    0
  );
  const atCap = totalMinutes >= MAX_MINUTES;

  if (slotsLoading || bookingsLoading) {
    return <p className="text-gray-500">{t("common.loading")}</p>;
  }

  // Sort picks for display (date asc, time asc)
  const pickedSorted = [...picked].sort((a, b) =>
    a.date === b.date
      ? a.start_time.localeCompare(b.start_time)
      : a.date.localeCompare(b.date)
  );
  // Format the total picked duration as a compact string (e.g. "1.5h", "2h").
  const totalDurationStr =
    totalMinutes < 60
      ? `${totalMinutes}m`
      : totalMinutes % 60 === 0
        ? `${totalMinutes / 60}h`
        : `${Math.floor(totalMinutes / 60)}.5h`;

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
                selectedSlotIds={pickedIds}
                onSelectSlot={(s) => toggleSlot(s as Slot)}
              />

              {adjacentSlot && (
                <button
                  type="button"
                  onClick={() => toggleSlot(adjacentSlot)}
                  className="mt-3 w-full flex items-center justify-center gap-1.5 border border-dashed border-brand-300 text-brand-700 hover:bg-brand-50 rounded-lg py-2 text-xs font-medium transition-colors"
                >
                  <Plus size={14} />
                  {t("booking.addConsecutive", {
                    time: `${adjacentSlot.start_time}–${adjacentSlot.end_time}`,
                  })}
                </button>
              )}
            </>
          )}
        </Card>
      </div>

      {/* Selection summary + submit */}
      {picked.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800">
              {t("booking.lessonSummary", { duration: totalDurationStr })}
            </h3>
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              {t("booking.clearAll")}
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            {pickedSorted.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1.5 bg-brand-50 border border-brand-200 text-brand-800 rounded-full ps-3 pe-1 py-1 text-sm"
              >
                <span className="font-medium">{formatDate(s.date)}</span>
                <span className="text-gray-500">·</span>
                <span className="font-mono">
                  {s.start_time}–{s.end_time}
                </span>
                <button
                  type="button"
                  onClick={() => toggleSlot(s)}
                  className="w-5 h-5 rounded-full hover:bg-brand-100 flex items-center justify-center"
                  aria-label="remove"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
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
              : t("booking.sendRequestN", { count: picked.length })}
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
