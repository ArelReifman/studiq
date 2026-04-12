"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import { CalendarDays, Send, X } from "lucide-react";

interface Slot {
  id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
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

const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function getNextDatesForDay(dayOfWeek: string, count: number): string[] {
  const dayIndex = DAYS.indexOf(dayOfWeek as (typeof DAYS)[number]);
  const dates: string[] = [];
  const today = new Date();

  for (let i = 0; i < 28 && dates.length < count; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    if (date.getDay() === dayIndex) {
      dates.push(date.toISOString().split("T")[0]);
    }
  }
  return dates;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function StudentBookPage() {
  const t = useT();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [slotsData, bookingsData] = await Promise.all([
        api.get<Slot[]>("/bookings/available-slots"),
        api.get<Booking[]>("/bookings/my"),
      ]);
      setSlots(slotsData);
      setBookings(bookingsData);
    } finally {
      setLoading(false);
    }
  }

  async function handleBook(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlot || !selectedDate) return;
    setSending(true);
    setSuccess(false);

    try {
      await api.post("/bookings", {
        availability_id: selectedSlot.id,
        date: selectedDate,
        note: note || undefined,
      });
      setSuccess(true);
      setSelectedSlot(null);
      setSelectedDate("");
      setNote("");
      // Reload bookings
      const updated = await api.get<Booking[]>("/bookings/my");
      setBookings(updated);
    } finally {
      setSending(false);
    }
  }

  async function cancelBooking(id: string) {
    await api.delete(`/bookings/${id}`);
    setBookings((prev) =>
      prev.map((b) => (b.id === id ? { ...b, status: "cancelled" } : b))
    );
  }

  // Group slots by day
  const slotsByDay = DAYS.reduce(
    (acc, d) => {
      const daySlots = slots.filter((s) => s.day_of_week === d);
      if (daySlots.length > 0) acc[d] = daySlots;
      return acc;
    },
    {} as Record<string, Slot[]>
  );

  const pendingBookings = bookings.filter((b) => b.status === "pending");
  const otherBookings = bookings.filter((b) => b.status !== "pending");

  if (loading)
    return <p className="text-gray-500">{t("common.loading")}</p>;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-800">
        {t("student.bookLesson")}
      </h1>

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
          {t("booking.requestSent")}
        </div>
      )}

      {/* ── Available Slots ── */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-semibold text-gray-700 flex items-center gap-2 mb-4">
          <CalendarDays size={18} />
          {t("student.availableSlots")}
        </h2>

        {Object.keys(slotsByDay).length === 0 ? (
          <p className="text-sm text-gray-400">{t("student.noSlots")}</p>
        ) : (
          <div className="space-y-4">
            {DAYS.filter((d) => slotsByDay[d]).map((d) => (
              <div key={d}>
                <h3 className="text-sm font-semibold text-gray-600 mb-2">
                  {t(`day.${d}`)}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {slotsByDay[d].map((slot) => (
                    <button
                      key={slot.id}
                      onClick={() => {
                        setSelectedSlot(slot);
                        setSelectedDate("");
                        setSuccess(false);
                      }}
                      className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                        selectedSlot?.id === slot.id
                          ? "bg-brand-600 text-white border-brand-600"
                          : "bg-white text-gray-700 border-gray-200 hover:border-brand-400 hover:bg-brand-50"
                      }`}
                    >
                      {slot.start_time} – {slot.end_time}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Date picker for selected slot */}
        {selectedSlot && (
          <form
            onSubmit={handleBook}
            className="mt-6 bg-gray-50 rounded-lg p-4 space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t("student.selectDate")}
              </label>
              <div className="flex flex-wrap gap-2">
                {getNextDatesForDay(selectedSlot.day_of_week, 4).map(
                  (date) => (
                    <button
                      key={date}
                      type="button"
                      onClick={() => setSelectedDate(date)}
                      className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                        selectedDate === date
                          ? "bg-brand-600 text-white border-brand-600"
                          : "bg-white text-gray-700 border-gray-200 hover:border-brand-400"
                      }`}
                    >
                      {formatDate(date)}
                    </button>
                  )
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("student.addNote")}
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder={t("student.addNote")}
              />
            </div>

            <button
              type="submit"
              disabled={!selectedDate || sending}
              className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              <Send size={14} />
              {sending ? t("student.sending") : t("student.sendRequest")}
            </button>
          </form>
        )}
      </section>

      {/* ── My Bookings ── */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">
          {t("student.myBookings")}
        </h2>

        {bookings.length === 0 ? (
          <p className="text-sm text-gray-400">{t("student.noBookings")}</p>
        ) : (
          <div className="space-y-3">
            {pendingBookings.map((b) => (
              <div
                key={b.id}
                className="border border-orange-200 bg-orange-50 rounded-lg p-4 flex items-center justify-between"
              >
                <div>
                  <p className="font-medium text-gray-800">
                    {formatDate(b.date)} · {b.start_time} – {b.end_time}
                  </p>
                  <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">
                    {t("booking.pending")}
                  </span>
                </div>
                <button
                  onClick={() => cancelBooking(b.id)}
                  className="text-sm text-red-500 hover:text-red-700 flex items-center gap-1"
                >
                  <X size={14} />
                  {t("student.cancelBooking")}
                </button>
              </div>
            ))}

            {otherBookings.map((b) => (
              <div
                key={b.id}
                className="border border-gray-100 rounded-lg p-4 flex items-center justify-between opacity-70"
              >
                <div>
                  <p className="font-medium text-gray-700">
                    {formatDate(b.date)} · {b.start_time} – {b.end_time}
                  </p>
                  {b.teacher_note && (
                    <p className="text-xs text-gray-500 mt-1">
                      "{b.teacher_note}"
                    </p>
                  )}
                </div>
                <span
                  className={`text-xs font-medium px-2 py-1 rounded-full ${
                    b.status === "approved"
                      ? "bg-green-100 text-green-700"
                      : b.status === "rejected"
                        ? "bg-red-100 text-red-700"
                        : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {t(`booking.${b.status}`)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
