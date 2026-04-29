"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Calendar, TimeSlotGrid, type TimeSlot } from "@/components/calendar/calendar";
import { Send, X } from "lucide-react";

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
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [note, setNote] = useState("");
  const [success, setSuccess] = useState(false);

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
    () => (selectedDate ? slots.filter((s) => s.date === selectedDate) : []),
    [slots, selectedDate]
  );

  const bookMutation = useMutation({
    mutationFn: () =>
      api.post("/bookings", {
        availability_id: selectedSlot!.id,
        note: note || undefined,
      }),
    onSuccess: () => {
      setSuccess(true);
      setSelectedSlot(null);
      setNote("");
      qc.invalidateQueries({ queryKey: ["booking-slots"] });
      qc.invalidateQueries({ queryKey: ["my-bookings"] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/bookings/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-bookings"] });
      qc.invalidateQueries({ queryKey: ["booking-slots"] });
    },
  });

  const pending = bookings.filter((b) => b.status === "pending");
  const approved = bookings.filter((b) => b.status === "approved");
  const past = bookings.filter((b) => b.status === "rejected" || b.status === "cancelled");

  if (slotsLoading || bookingsLoading) {
    return <p className="text-gray-500">{t("common.loading")}</p>;
  }

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

      {/* Calendar + Time picker */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <Calendar
            activeDates={activeDates}
            selectedDate={selectedDate}
            onSelectDate={(d) => {
              setSelectedDate(d);
              setSelectedSlot(null);
              setSuccess(false);
            }}
          />
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
                selectedSlotId={selectedSlot?.id}
                onSelectSlot={(s) => setSelectedSlot(s as Slot)}
              />

              {selectedSlot && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    bookMutation.mutate();
                  }}
                  className="mt-4 pt-4 border-t border-gray-100 space-y-3"
                >
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t("student.addNote")}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <button
                    type="submit"
                    disabled={bookMutation.isPending}
                    className="w-full flex items-center justify-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                  >
                    <Send size={14} />
                    {bookMutation.isPending
                      ? t("student.sending")
                      : t("student.sendRequest")}
                  </button>
                </form>
              )}
            </>
          )}
        </Card>
      </div>

      {/* My bookings */}
      <Card>
        <h2 className="text-lg font-semibold text-gray-700 mb-4">
          {t("student.myBookings")}
        </h2>

        {bookings.length === 0 ? (
          <p className="text-sm text-gray-400">{t("student.noBookings")}</p>
        ) : (
          <div className="space-y-2">
            {[...pending, ...approved, ...past].map((b) => (
              <div
                key={b.id}
                className={
                  b.status === "pending"
                    ? "border border-orange-200 bg-orange-50 rounded-lg p-3 flex items-center justify-between"
                    : b.status === "approved"
                      ? "border border-green-200 bg-green-50 rounded-lg p-3 flex items-center justify-between"
                      : "border border-gray-100 rounded-lg p-3 flex items-center justify-between opacity-60"
                }
              >
                <div>
                  <p className="font-medium text-gray-800">
                    {formatDate(b.date)} · {b.start_time}–{b.end_time}
                  </p>
                  <span
                    className={
                      b.status === "pending"
                        ? "text-xs text-orange-600"
                        : b.status === "approved"
                          ? "text-xs text-green-700"
                          : "text-xs text-gray-500"
                    }
                  >
                    {t(`booking.${b.status}`)}
                  </span>
                  {b.teacher_note && (
                    <p className="text-xs text-gray-500 mt-1 italic">
                      &ldquo;{b.teacher_note}&rdquo;
                    </p>
                  )}
                </div>
                {(b.status === "pending" || b.status === "approved") && (
                  <button
                    onClick={() => cancelMutation.mutate(b.id)}
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
