"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Calendar, TimeSlotGrid, type TimeSlot } from "@/components/calendar/calendar";
import { Plus, CalendarCheck, MessageSquare } from "lucide-react";

interface Slot extends TimeSlot {
  date: string;
}

interface BookingRow {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  student_note: string | null;
  teacher_note: string | null;
  student_name: string;
  student_id: string;
  created_at: string;
}

function formatDate(s: string): string {
  return new Date(s + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function TeacherSchedulePage() {
  const t = useT();
  const qc = useQueryClient();

  const [selectedDate, setSelectedDate] = useState<string | undefined>(() => {
    return new Date().toISOString().split("T")[0]!;
  });
  const [startTime, setStartTime] = useState("14:00");
  const [endTime, setEndTime] = useState("15:00");
  const [error, setError] = useState<string | null>(null);

  const { data: slots = [], isLoading: slotsLoading } = useQuery<Slot[]>({
    queryKey: ["my-availability"],
    queryFn: () => api.get("/availability"),
  });

  const { data: bookings = [], isLoading: bookingsLoading } = useQuery<BookingRow[]>({
    queryKey: ["my-bookings-as-teacher"],
    queryFn: () => api.get("/bookings/requests"),
  });

  const today = new Date().toISOString().split("T")[0]!;

  const upcomingApproved = useMemo(
    () =>
      bookings
        .filter((b) => b.status === "approved" && b.date >= today)
        .sort((a, b) =>
          a.date === b.date
            ? a.start_time.localeCompare(b.start_time)
            : a.date.localeCompare(b.date)
        ),
    [bookings, today]
  );

  const bookedDates = useMemo(
    () => new Set(upcomingApproved.map((b) => b.date)),
    [upcomingApproved]
  );

  const activeDates = useMemo(() => new Set(slots.map((s) => s.date)), [slots]);

  // Hide slots that are already taken (have an approved or pending booking on
  // them) so the teacher doesn't accidentally try to manage a booked slot.
  const takenSlotIds = useMemo(() => {
    const ids = new Set<string>();
    for (const b of bookings) {
      if (b.status === "approved" || b.status === "pending") {
        // The booking has availability_id internally; here we don't have it,
        // so we match by date+time. (See API: bookings inherit slot times.)
      }
    }
    return ids;
  }, [bookings]);

  const slotsForDate = useMemo(() => {
    if (!selectedDate) return [];
    const taken = new Set(
      bookings
        .filter(
          (b) =>
            (b.status === "approved" || b.status === "pending") &&
            b.date === selectedDate
        )
        .map((b) => `${b.start_time}-${b.end_time}`)
    );
    return slots
      .filter((s) => s.date === selectedDate)
      .filter((s) => !taken.has(`${s.start_time}-${s.end_time}`));
  }, [slots, bookings, selectedDate]);

  const bookingsOnSelectedDate = useMemo(
    () =>
      selectedDate
        ? bookings
            .filter(
              (b) =>
                b.date === selectedDate &&
                (b.status === "approved" || b.status === "pending")
            )
            .sort((a, b) => a.start_time.localeCompare(b.start_time))
        : [],
    [bookings, selectedDate]
  );

  const addMutation = useMutation({
    mutationFn: () =>
      api.post<Slot>("/availability", {
        date: selectedDate,
        start_time: startTime,
        end_time: endTime,
      }),
    onMutate: () => setError(null),
    onError: (e: Error) => setError(e.message),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-availability"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (slotId: string) => api.delete(`/availability/${slotId}`),
    onError: (e: Error) => setError(e.message),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-availability"] });
    },
  });

  if (slotsLoading || bookingsLoading) {
    return <p className="text-gray-500">{t("common.loading")}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">
          {t("teacher.schedule")}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {t("teacher.scheduleHint")}
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Calendar */}
        <Card>
          <Calendar
            activeDates={activeDates}
            bookedDates={bookedDates}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
          <div className="flex flex-wrap gap-4 justify-center mt-3 text-xs text-gray-500">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-brand-100 border border-brand-200" />
              {t("teacher.legendOpen")}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {t("teacher.legendBooked")}
            </div>
          </div>
        </Card>

        {/* Manage slots for selected date */}
        <Card>
          {selectedDate ? (
            <>
              {bookingsOnSelectedDate.length > 0 && (
                <div className="mb-4 pb-4 border-b border-gray-100 space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                    {t("teacher.bookedOnThisDate")}
                  </p>
                  {bookingsOnSelectedDate.map((b) => (
                    <div
                      key={b.id}
                      className={
                        b.status === "approved"
                          ? "flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm"
                          : "flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-sm"
                      }
                    >
                      <span className="font-mono text-gray-700">
                        {b.start_time}–{b.end_time}
                      </span>
                      <span className="text-gray-700">·</span>
                      <span className="font-medium text-gray-800">
                        {b.student_name}
                      </span>
                      <span
                        className={
                          b.status === "approved"
                            ? "ms-auto text-xs text-green-700"
                            : "ms-auto text-xs text-orange-600"
                        }
                      >
                        {t(`booking.${b.status}`)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <TimeSlotGrid
                date={selectedDate}
                slots={slotsForDate}
                onSelectSlot={() => {}}
                onRemoveSlot={(s) => removeMutation.mutate(s.id)}
                emptyLabel={t("teacher.noSlotsForDate")}
              />

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (startTime >= endTime) {
                    setError(t("teacher.endAfterStart"));
                    return;
                  }
                  addMutation.mutate();
                }}
                className="mt-4 pt-4 border-t border-gray-100"
              >
                <p className="text-sm font-medium text-gray-700 mb-2">
                  {t("teacher.addSlotForDate")}
                </p>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">
                      {t("teacher.startTime")}
                    </label>
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">
                      {t("teacher.endTime")}
                    </label>
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={addMutation.isPending}
                    className="flex items-center gap-1 bg-brand-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                  >
                    <Plus size={14} />
                    {t("teacher.add")}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <p className="text-sm text-gray-400 text-center py-12">
              {t("teacher.pickDateFirst")}
            </p>
          )}
        </Card>
      </div>

      {/* Upcoming approved lessons */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <CalendarCheck size={18} className="text-green-600" />
          <h2 className="text-lg font-semibold text-gray-800">
            {t("teacher.upcomingLessons")}
          </h2>
          {upcomingApproved.length > 0 && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              {upcomingApproved.length}
            </span>
          )}
        </div>

        {upcomingApproved.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">
            {t("teacher.noUpcomingLessons")}
          </p>
        ) : (
          <div className="space-y-2">
            {upcomingApproved.map((b) => (
              <div
                key={b.id}
                className="flex items-start justify-between gap-3 border border-gray-100 rounded-lg p-3 hover:border-brand-200 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-sm text-gray-700">
                      {formatDate(b.date)}
                    </span>
                    <span className="font-mono text-sm font-semibold text-brand-700">
                      {b.start_time}–{b.end_time}
                    </span>
                    <span className="font-medium text-gray-800">
                      {b.student_name}
                    </span>
                  </div>
                  {b.student_note && (
                    <div className="flex items-start gap-1.5 mt-1.5 text-xs text-gray-500">
                      <MessageSquare size={11} className="flex-shrink-0 mt-0.5" />
                      <span className="italic">{b.student_note}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
