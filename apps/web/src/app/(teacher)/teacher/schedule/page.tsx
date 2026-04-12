"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import { Clock, Plus, Trash2, Check, X } from "lucide-react";

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
  student_name: string;
  student_id: string;
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

export default function TeacherSchedulePage() {
  const t = useT();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  // Form state
  const [day, setDay] = useState<string>("sunday");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [rejectNote, setRejectNote] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [slotsData, bookingsData] = await Promise.all([
        api.get<Slot[]>("/availability"),
        api.get<Booking[]>("/bookings/requests"),
      ]);
      setSlots(slotsData);
      setBookings(bookingsData);
    } finally {
      setLoading(false);
    }
  }

  async function addSlot(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      const slot = await api.post<Slot>("/availability", {
        day_of_week: day,
        start_time: startTime,
        end_time: endTime,
      });
      setSlots((prev) => [...prev, slot]);
    } finally {
      setAdding(false);
    }
  }

  async function removeSlot(id: string) {
    await api.delete(`/availability/${id}`);
    setSlots((prev) => prev.filter((s) => s.id !== id));
  }

  async function respondToBooking(id: string, status: "approved" | "rejected") {
    setRespondingId(id);
    try {
      await api.patch(`/bookings/${id}`, {
        status,
        note: status === "rejected" ? rejectNote : undefined,
      });
      setBookings((prev) =>
        prev.map((b) => (b.id === id ? { ...b, status } : b))
      );
      setRejectNote("");
    } finally {
      setRespondingId(null);
    }
  }

  const pendingBookings = bookings.filter((b) => b.status === "pending");
  const handledBookings = bookings.filter((b) => b.status !== "pending");

  // Group slots by day
  const slotsByDay = DAYS.reduce(
    (acc, d) => {
      const daySlots = slots.filter((s) => s.day_of_week === d);
      if (daySlots.length > 0) acc[d] = daySlots;
      return acc;
    },
    {} as Record<string, Slot[]>
  );

  if (loading)
    return <p className="text-gray-500">{t("common.loading")}</p>;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-800">
        {t("teacher.schedule")}
      </h1>

      {/* ── Availability Section ── */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-700 flex items-center gap-2">
            <Clock size={18} />
            {t("teacher.availability")}
          </h2>
        </div>

        {/* Add slot form */}
        <form
          onSubmit={addSlot}
          className="flex flex-wrap items-end gap-3 mb-6 bg-gray-50 rounded-lg p-4"
        >
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {t("teacher.day")}
            </label>
            <select
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {t(`day.${d}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {t("teacher.startTime")}
            </label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {t("teacher.endTime")}
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={adding}
            className="flex items-center gap-1 bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            <Plus size={14} />
            {t("teacher.addAvailability")}
          </button>
        </form>

        {/* Current slots */}
        {Object.keys(slotsByDay).length === 0 ? (
          <p className="text-sm text-gray-400">{t("teacher.noSlots")}</p>
        ) : (
          <div className="space-y-3">
            {DAYS.filter((d) => slotsByDay[d]).map((d) => (
              <div key={d}>
                <h3 className="text-sm font-semibold text-gray-600 mb-1">
                  {t(`day.${d}`)}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {slotsByDay[d].map((slot) => (
                    <div
                      key={slot.id}
                      className="flex items-center gap-2 bg-brand-50 border border-brand-100 rounded-lg px-3 py-1.5 text-sm"
                    >
                      <span className="text-brand-700 font-medium">
                        {slot.start_time} – {slot.end_time}
                      </span>
                      <button
                        onClick={() => removeSlot(slot.id)}
                        className="text-gray-400 hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Booking Requests Section ── */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">
          {t("teacher.bookingRequests")}
          {pendingBookings.length > 0 && (
            <span className="ms-2 bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full text-xs">
              {pendingBookings.length}
            </span>
          )}
        </h2>

        {pendingBookings.length === 0 && handledBookings.length === 0 ? (
          <p className="text-sm text-gray-400">{t("teacher.noBookings")}</p>
        ) : (
          <div className="space-y-3">
            {/* Pending first */}
            {pendingBookings.map((b) => (
              <div
                key={b.id}
                className="border border-orange-200 bg-orange-50 rounded-lg p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-gray-800">
                      {b.student_name}
                    </p>
                    <p className="text-sm text-gray-600">
                      {b.date} · {b.start_time} – {b.end_time}
                    </p>
                    {b.student_note && (
                      <p className="text-sm text-gray-500 mt-1 italic">
                        "{b.student_note}"
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => respondToBooking(b.id, "approved")}
                      disabled={respondingId === b.id}
                      className="flex items-center gap-1 bg-green-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
                    >
                      <Check size={14} />
                      {t("teacher.approve")}
                    </button>
                    <button
                      onClick={() => respondToBooking(b.id, "rejected")}
                      disabled={respondingId === b.id}
                      className="flex items-center gap-1 bg-red-500 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-red-600 disabled:opacity-50"
                    >
                      <X size={14} />
                      {t("teacher.reject")}
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Handled bookings */}
            {handledBookings.map((b) => (
              <div
                key={b.id}
                className="border border-gray-100 rounded-lg p-4 opacity-70"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-700">
                      {b.student_name}
                    </p>
                    <p className="text-sm text-gray-500">
                      {b.date} · {b.start_time} – {b.end_time}
                    </p>
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
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
