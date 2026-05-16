"use client";

import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useT, useLocaleStore } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Calendar, TimeSlotGrid, type TimeSlot } from "@/components/calendar/calendar";
import { Plus, CalendarCheck, MessageSquare, X, CalendarDays, CheckCircle2, AlertCircle, Pencil } from "lucide-react";
import { groupConsecutiveBookings, formatDurationI18n, type BookingGroup } from "@/lib/booking-grouping";
import { LessonFormModal, type EditableGroup } from "@/components/teacher/LessonFormModal";

interface Slot extends TimeSlot {
  date: string;
}

interface BookingRow {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  status:
    | "pending"
    | "approved"
    | "rejected"
    | "cancel_requested"
    | "cancelled";
  student_note: string | null;
  teacher_note: string | null;
  attendance: "attended" | "no_show" | null;
  student_name: string;
  student_id: string;
  created_at: string;
  /** Course associated with this lesson. Null for legacy lessons. */
  course_id?: string | null;
}

type Attendance = "attended" | "no_show" | null;

// Locale-aware date formatter. Passing `undefined` falls back to the browser
// (iOS Safari) locale, which on mobile commonly differs from the in-app UI
// language — producing "Sun 17 May" in a Hebrew UI. Passing the active app
// locale forces the correct script ("יום א׳ 17 במאי" in Hebrew).
function formatDate(s: string, locale: "he" | "en"): string {
  return new Date(s + "T00:00:00").toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// True iff this lesson's end_time has already passed (Israel local time, but
// since the page runs in the teacher's browser using their tz, comparing
// against `new Date()` is correct enough — both teacher and slot are in IL).
function hasLessonEnded(date: string, endTime: string): boolean {
  return new Date(`${date}T${endTime}:00`).getTime() <= Date.now();
}

export default function TeacherSchedulePage() {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const qc = useQueryClient();
  const searchParams = useSearchParams();

  const [selectedDate, setSelectedDate] = useState<string | undefined>(() => {
    return new Date().toISOString().split("T")[0]!;
  });
  const [startTime, setStartTime] = useState("14:00");
  const [endTime, setEndTime] = useState("15:00");
  const [error, setError] = useState<string | null>(null);
  const [gcalBanner, setGcalBanner] = useState<"connected" | "error" | null>(null);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [showCancelledTeacher, setShowCancelledTeacher] = useState(false);
  const [showAllPast, setShowAllPast] = useState(false);

  // Lesson form modal state
  const [lessonModal, setLessonModal] = useState<
    | { mode: "create" }
    | { mode: "edit"; group: EditableGroup }
    | null
  >(null);

  // Show a banner if Google Calendar OAuth redirected back here
  useEffect(() => {
    const gcal = searchParams.get("gcal");
    if (gcal === "connected") setGcalBanner("connected");
    else if (gcal === "error") setGcalBanner("error");
  }, [searchParams]);

  const { data: gcalStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["gcal-status"],
    queryFn: () => api.get("/auth/google/status"),
  });

  const disconnectGcalMutation = useMutation({
    mutationFn: () => api.delete("/auth/google"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gcal-status"] }),
  });

  const connectGcalMutation = useMutation({
    mutationFn: () => api.get<{ url: string }>("/auth/google/start"),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (e: Error) => setError(e.message),
  });

  const { data: slots = [], isLoading: slotsLoading } = useQuery<Slot[]>({
    queryKey: ["my-availability"],
    queryFn: () => api.get("/availability"),
  });

  const { data: bookings = [], isLoading: bookingsLoading } = useQuery<BookingRow[]>({
    queryKey: ["my-bookings-as-teacher"],
    queryFn: () => api.get("/bookings/requests"),
  });

  const today = new Date().toISOString().split("T")[0]!;

  // Approved + cancel-requested both still occupy the slot; show both in the
  // upcoming list so the teacher sees a lesson that's pending cancellation.
  const upcomingActive = useMemo(
    () =>
      bookings.filter(
        (b) =>
          (b.status === "approved" || b.status === "cancel_requested") &&
          b.date >= today &&
          // Today's lessons that already ended belong in the "Past" section
          // (where the teacher marks attendance), not in "Upcoming".
          !hasLessonEnded(b.date, b.end_time)
      ),
    [bookings, today]
  );

  const upcomingGroups = useMemo(
    () => groupConsecutiveBookings(upcomingActive),
    [upcomingActive]
  );

  // Recent ended lessons (last 30 days, including today's already-finished
  // ones) — these are the ones the teacher can mark as attended / no-show.
  const recentPast = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().split("T")[0]!;
    return bookings.filter(
      (b) =>
        (b.status === "approved" || b.status === "cancel_requested") &&
        b.date >= cutoffStr &&
        hasLessonEnded(b.date, b.end_time)
    );
  }, [bookings]);

  const recentPastGroups = useMemo(
    () =>
      groupConsecutiveBookings(recentPast).sort((a, b) =>
        // Most recent first (latest start time wins).
        b.date === a.date
          ? b.start_time.localeCompare(a.start_time)
          : b.date.localeCompare(a.date)
      ),
    [recentPast]
  );

  const UPCOMING_PAGE = 5;
  const visibleUpcoming = showAllUpcoming
    ? upcomingGroups
    : upcomingGroups.slice(0, UPCOMING_PAGE);

  // Teacher-cancelled lessons — for the collapsible section.
  const cancelledTeacherGroups = useMemo(
    () =>
      groupConsecutiveBookings(
        bookings.filter((b) => b.status === "cancelled")
      ).sort((a, b) =>
        b.date === a.date
          ? b.start_time.localeCompare(a.start_time)
          : b.date.localeCompare(a.date)
      ),
    [bookings]
  );

  const PAST_PAGE = 5;
  const visiblePast = showAllPast
    ? recentPastGroups
    : recentPastGroups.slice(0, PAST_PAGE);

  const bookedDates = useMemo(
    () => new Set(upcomingActive.map((b) => b.date)),
    [upcomingActive]
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

  const groupsOnSelectedDate = useMemo(() => {
    if (!selectedDate) return [];
    const dayBookings = bookings.filter(
      (b) =>
        b.date === selectedDate &&
        (b.status === "approved" ||
          b.status === "pending" ||
          b.status === "cancel_requested")
    );
    return groupConsecutiveBookings(dayBookings);
  }, [bookings, selectedDate]);

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

  // Cancel an approved (or pending) lesson — one atomic request for the whole
  // group so a 2-hour booking gets one gcal deletion and one Telegram ping.
  const cancelLessonMutation = useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) => {
      await api.patch("/bookings/batch-status", { ids, status: "cancelled" });
    },
    onError: (e: Error) => setError(e.message),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-bookings-as-teacher"] });
      qc.invalidateQueries({ queryKey: ["my-availability"] });
      qc.invalidateQueries({ queryKey: ["booking-slots"] });
    },
  });
  // Marks the whole grouped lesson (1+ slots) as attended / no_show / unset.
  // Each row is updated independently — backend keeps them in sync since the
  // teacher always marks a group as one unit.
  const markAttendanceMutation = useMutation({
    mutationFn: async ({
      ids,
      attendance,
    }: {
      ids: string[];
      attendance: Attendance;
    }) => {
      await Promise.all(
        ids.map((id) =>
          api.patch(`/bookings/${id}/attendance`, { attendance })
        )
      );
    },
    onError: (e: Error) => setError(e.message),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-bookings-as-teacher"] });
      qc.invalidateQueries({ queryKey: ["my-availability"] });
      qc.invalidateQueries({ queryKey: ["booking-slots"] });
    },
  });

  if (slotsLoading || bookingsLoading) {
    return <p className="text-gray-500">{t("common.loading")}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">
            {t("teacher.schedule")}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {t("teacher.scheduleHint")}
          </p>
        </div>

        {/* Schedule lesson + Google Calendar connect / disconnect */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLessonModal({ mode: "create" })}
            className="flex items-center gap-1.5 text-sm text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-1.5 font-medium transition-colors shadow-sm"
          >
            <Plus size={14} />
            {t("teacher.scheduleLesson")}
          </button>
          {gcalStatus?.connected ? (
            <>
              <span className="flex items-center gap-1.5 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                <CheckCircle2 size={14} />
                {t("teacher.gcalConnected")}
              </span>
              <button
                type="button"
                onClick={() => disconnectGcalMutation.mutate()}
                disabled={disconnectGcalMutation.isPending}
                className="text-xs text-gray-500 hover:text-red-600 transition-colors px-2 py-1.5 rounded-md hover:bg-red-50"
              >
                {t("teacher.gcalDisconnect")}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => connectGcalMutation.mutate()}
              disabled={connectGcalMutation.isPending}
              className="flex items-center gap-1.5 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:border-brand-300 hover:bg-brand-50 transition-colors shadow-sm disabled:opacity-50"
            >
              <CalendarDays size={14} />
              {t("teacher.gcalConnect")}
            </button>
          )}
        </div>
      </div>

      {/* Google Calendar OAuth result banner */}
      {gcalBanner === "connected" && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
          <CheckCircle2 size={15} />
          {t("teacher.gcalConnectedBanner")}
          <button
            type="button"
            onClick={() => setGcalBanner(null)}
            className="ms-auto text-green-600 hover:text-green-800"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {gcalBanner === "error" && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <AlertCircle size={15} />
          {t("teacher.gcalErrorBanner")}
          <button
            type="button"
            onClick={() => setGcalBanner(null)}
            className="ms-auto text-red-600 hover:text-red-800"
          >
            <X size={14} />
          </button>
        </div>
      )}

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
              {groupsOnSelectedDate.length > 0 && (
                <div className="mb-4 pb-4 border-b border-gray-100 space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                    {t("teacher.bookedOnThisDate")}
                  </p>
                  {groupsOnSelectedDate.map((g) => (
                    <div
                      key={g.key}
                      className={
                        g.status === "approved"
                          ? "flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm"
                          : "flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-sm"
                      }
                    >
                      <span className="font-mono text-gray-700">
                        {g.start_time}–{g.end_time}
                      </span>
                      {g.hours > 1 && (
                        <span className="text-xs text-gray-500">
                          ({formatDurationI18n(g.hours, t)})
                        </span>
                      )}
                      <span className="text-gray-700">·</span>
                      <span className="font-medium text-gray-800">
                        {g.student_name}
                      </span>
                      <span
                        className={
                          g.status === "approved"
                            ? "ms-auto text-xs text-green-700"
                            : "ms-auto text-xs text-orange-600"
                        }
                      >
                        {t(`booking.${g.status}`)}
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
                {/* On mobile (< sm), the two time inputs sit side by side and
                    the Add button wraps to its own full-width row below — so
                    the button never overlaps the end-time input on narrow
                    screens. On sm+ it stays a single row as before. */}
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-0">
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
                  <div className="flex-1 min-w-0">
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
                    className="w-full sm:w-auto flex items-center justify-center gap-1 bg-brand-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
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
          {upcomingGroups.length > 0 && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              {upcomingGroups.length}
            </span>
          )}
        </div>

        {upcomingGroups.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">
            {t("teacher.noUpcomingLessons")}
          </p>
        ) : (
          <div className="space-y-2">
            {visibleUpcoming.map((g) => {
              const isCancelRequest = g.status === "cancel_requested";
              return (
                <div
                  key={g.key}
                  className={
                    isCancelRequest
                      ? "flex items-start justify-between gap-3 border border-red-200 bg-red-50 rounded-lg p-3 transition-colors"
                      : "flex items-start justify-between gap-3 border border-gray-100 rounded-lg p-3 hover:border-brand-200 transition-colors"
                  }
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-800">
                        {g.student_name}
                      </span>
                      <span className="text-sm text-gray-500">
                        {formatDate(g.date, locale)}
                      </span>
                      <span className="font-mono text-sm font-semibold text-brand-700" dir="ltr">
                        {g.start_time}–{g.end_time}
                      </span>
                      {g.hours >= 1 && (
                        <span className="text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full font-medium">
                          {formatDurationI18n(g.hours, t)}
                        </span>
                      )}
                      {isCancelRequest && (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                          {t("teacher.cancelPending")}
                        </span>
                      )}
                    </div>
                    {g.student_note && (
                      <div className="flex items-start gap-1.5 mt-1 text-xs text-gray-500">
                        <MessageSquare size={11} className="flex-shrink-0 mt-0.5" />
                        <span className="italic">{g.student_note}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-1">
                    {/* Edit — only for upcoming (not cancel_requested) lessons */}
                    {!isCancelRequest && (
                      <button
                        type="button"
                        onClick={() =>
                          setLessonModal({
                            mode: "edit",
                            group: {
                              ids: g.ids,
                              student_id: g.student_id,
                              student_name: g.student_name,
                              date: g.date,
                              start_time: g.start_time,
                              end_time: g.end_time,
                              course_id: g.course_id ?? null,
                            },
                          })
                        }
                        className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800 hover:bg-brand-50 rounded-md px-2 py-1 transition-colors"
                      >
                        <Pencil size={12} />
                        {t("teacher.editLesson")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(t("teacher.confirmCancelLesson"))) {
                          cancelLessonMutation.mutate({ ids: g.ids });
                        }
                      }}
                      disabled={cancelLessonMutation.isPending}
                      className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md px-2 py-1 transition-colors disabled:opacity-50"
                    >
                      <X size={13} />
                      {t("teacher.cancelLesson")}
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Show more / less */}
            {upcomingGroups.length > UPCOMING_PAGE && (
              <button
                type="button"
                onClick={() => setShowAllUpcoming((v) => !v)}
                className="w-full text-xs text-brand-600 hover:text-brand-800 py-1.5 border border-dashed border-brand-200 rounded-lg hover:bg-brand-50 transition-colors"
              >
                {showAllUpcoming
                  ? t("common.showLess")
                  : `${t("common.showMore")} (${upcomingGroups.length - UPCOMING_PAGE})`}
              </button>
            )}
          </div>
        )}

        {/* Cancelled lessons — collapsible */}
        {cancelledTeacherGroups.length > 0 && (
          <div className={`${upcomingGroups.length > 0 ? "mt-3 pt-3" : "mt-1"} border-t border-gray-100`}>
            <button
              type="button"
              onClick={() => setShowCancelledTeacher((v) => !v)}
              className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 py-1 w-full text-start"
            >
              <span className={`transition-transform duration-150 ${showCancelledTeacher ? "rotate-90" : ""}`}>
                ▶
              </span>
              {t("booking.cancelledLessons")}
              <span className="bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5 font-medium">
                {cancelledTeacherGroups.length}
              </span>
            </button>
            {showCancelledTeacher && (
              <div className="mt-1 space-y-1.5">
                {cancelledTeacherGroups.map((g) => (
                  <div
                    key={g.key}
                    className="border border-gray-100 rounded-lg p-3 opacity-55"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-gray-600">
                        {g.student_name}
                      </span>
                      <span className="text-sm text-gray-500">
                        {formatDate(g.date, locale)}
                      </span>
                      <span className="font-mono text-sm text-gray-600" dir="ltr">
                        {g.start_time}–{g.end_time}
                      </span>
                      {g.hours >= 1 && (
                        <span className="text-xs text-gray-400">
                          {formatDurationI18n(g.hours, t)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Past lessons — mark whether each one actually took place */}
      {recentPastGroups.length > 0 && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <CalendarCheck size={18} className="text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-800">
              {t("teacher.pastLessons")}
            </h2>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
              {recentPastGroups.length}
            </span>
          </div>

          <div className="space-y-2">
            {visiblePast.map((g) => {
              // All bookings in a group are marked together, so the first
              // booking's attendance is canonical for the whole group.
              const attendance =
                (g.bookings[0]?.attendance as Attendance) ?? null;
              return (
                <div
                  key={g.key}
                  className="flex items-start justify-between gap-3 border border-gray-100 rounded-lg p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-medium text-gray-800">
                        {g.student_name}
                      </span>
                      <span className="text-sm text-gray-500">
                        {formatDate(g.date, locale)}
                      </span>
                      <span className="font-mono text-sm font-semibold text-gray-700" dir="ltr">
                        {g.start_time}–{g.end_time}
                      </span>
                      {g.hours >= 1 && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
                          {formatDurationI18n(g.hours, t)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Three-segment toggle: Took place / Didn't / Not marked */}
                  <div className="flex-shrink-0 flex items-center rounded-md overflow-hidden border border-gray-200 text-xs">
                    <button
                      type="button"
                      disabled={markAttendanceMutation.isPending}
                      onClick={() =>
                        markAttendanceMutation.mutate({
                          ids: g.ids,
                          attendance:
                            attendance === "attended" ? null : "attended",
                        })
                      }
                      className={
                        attendance === "attended"
                          ? "px-2.5 py-1 bg-green-100 text-green-700 font-medium"
                          : "px-2.5 py-1 text-gray-500 hover:bg-gray-50"
                      }
                    >
                      {t("teacher.attended")}
                    </button>
                    <button
                      type="button"
                      disabled={markAttendanceMutation.isPending}
                      onClick={() =>
                        markAttendanceMutation.mutate({
                          ids: g.ids,
                          attendance:
                            attendance === "no_show" ? null : "no_show",
                        })
                      }
                      className={
                        attendance === "no_show"
                          ? "px-2.5 py-1 bg-red-100 text-red-700 font-medium border-s border-gray-200"
                          : "px-2.5 py-1 text-gray-500 hover:bg-gray-50 border-s border-gray-200"
                      }
                    >
                      {t("teacher.noShow")}
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Show more / less for past lessons */}
            {recentPastGroups.length > PAST_PAGE && (
              <button
                type="button"
                onClick={() => setShowAllPast((v) => !v)}
                className="w-full text-xs text-gray-500 hover:text-gray-700 py-1.5 border border-dashed border-gray-200 rounded-lg hover:bg-gray-50 transition-colors mt-1"
              >
                {showAllPast
                  ? t("common.showLess")
                  : `${t("common.showMore")} (${recentPastGroups.length - PAST_PAGE})`}
              </button>
            )}
          </div>
        </Card>
      )}

      {/* Lesson form modal — create or edit */}
      {lessonModal && (
        <LessonFormModal
          mode={lessonModal.mode}
          existingGroup={lessonModal.mode === "edit" ? lessonModal.group : undefined}
          onClose={() => setLessonModal(null)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["my-bookings-as-teacher"] });
          }}
        />
      )}
    </div>
  );
}
