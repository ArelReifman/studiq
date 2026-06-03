"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, CalendarCheck, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";

// ── Constants ─────────────────────────────────────────────────────────────────

const DURATIONS = [60, 90, 120, 150, 180] as const;
type Duration = (typeof DURATIONS)[number];

const DURATION_KEYS: Record<Duration, string> = {
  60: "teacher.duration60",
  90: "teacher.duration90",
  120: "teacher.duration120",
  150: "teacher.duration150",
  180: "teacher.duration180",
};

/** Valid start times: 10:00 – 21:00 in 30-min steps (23 options). */
function generateTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 10; h <= 21; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 21) slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
}

const TIME_SLOTS = generateTimeSlots();

/**
 * Returns the current date (YYYY-MM-DD) and wall-clock time (HH:mm) in the
 * Israel timezone. Used client-side to filter past slots and block past saves.
 * Mirrors the server's getIsraelToday() / getIsraelTimeHHMM() from time.ts.
 */
function getIsraelNow(): { date: string; time: string } {
  const now = new Date();
  const tz = "Asia/Jerusalem";

  const dp = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const date = `${dp.find((p) => p.type === "year")!.value}-${dp.find((p) => p.type === "month")!.value}-${dp.find((p) => p.type === "day")!.value}`;

  const tp = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = tp.find((p) => p.type === "hour")!.value;
  const m = tp.find((p) => p.type === "minute")!.value;
  // Intl can return "24:00" at the day boundary in some runtimes — normalise.
  const time = `${h === "24" ? "00" : h}:${m}`;

  return { date, time };
}

function timeToMin(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function addMin(hhmm: string, mins: number): string {
  const total = timeToMin(hhmm) + mins;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Minimal shape used by the schedule's `["my-bookings-as-teacher"]` cache
 * and by `groupConsecutiveBookings`. Defined inline (instead of imported)
 * so this component stays independent of the schedule page's local type.
 */
interface OptimisticBookingRow {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: "approved";
  student_note: null;
  teacher_note: string | null;
  attendance: null;
  student_name: string;
  student_id: string;
  created_at: string;
  course_id: string | null;
  gcal_event_id: null;
  calendar_sync_status: "pending";
}

function inferDuration(startTime: string, endTime: string): Duration {
  const min = timeToMin(endTime) - timeToMin(startTime);
  return (DURATIONS as readonly number[]).includes(min) ? (min as Duration) : 60;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface StudentOption {
  id: string;
  full_name: string;
}

/**
 * The slice of a booking group that the modal needs for pre-fill in edit mode.
 * Matches the `BookingGroup` shape from booking-grouping.ts.
 */
export interface EditableGroup {
  ids: string[];
  student_id: string;
  student_name: string;
  date: string;
  start_time: string;
  end_time: string;
  /** Course set on the lesson. Null for legacy lessons without a course. */
  course_id?: string | null;
}

export interface LessonFormModalProps {
  mode: "create" | "edit";
  /**
   * Pre-fills the student selector (create mode).
   * When provided, the student cannot be changed — the selector is hidden and
   * the student name is shown as static text.
   */
  initialStudentId?: string;
  initialStudentName?: string;
  /** Required in edit mode. */
  existingGroup?: EditableGroup;
  onClose: () => void;
  /** Called after a successful create or edit (before onClose). */
  onSuccess: () => void;
}

// ── TimeSelect ────────────────────────────────────────────────────────────────

interface TimeSelectProps {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /**
   * An existing time that may be outside the 10:00–21:00 range (edit mode for
   * old lessons). If supplied and out-of-range, shown as a separate selectable
   * option so the form doesn't break.
   */
  legacySlot?: string;
  /**
   * When the selected date is today, pass the current Israel HH:mm here.
   * All slots at or before this time are hidden so the teacher can't pick a
   * time that has already passed.
   */
  minTime?: string;
}

function TimeSelect({ value, onChange, placeholder, legacySlot, minTime }: TimeSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // When date is today, hide slots that are at or before the current Israel time.
  const visibleSlots = minTime
    ? TIME_SLOTS.filter((slot) => slot > minTime)
    : TIME_SLOTS;

  const hasLegacy = Boolean(legacySlot && !TIME_SLOTS.includes(legacySlot));

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((prev: boolean) => !prev)}
        className={[
          "w-full flex items-center justify-between border rounded-lg px-3 py-2 text-sm bg-white",
          "focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200 transition-colors",
          value ? "text-gray-800 border-gray-200" : "text-gray-400 border-gray-200",
        ].join(" ")}
      >
        <span>{value || placeholder}</span>
        <ChevronDown
          size={15}
          className={`text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-20 top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <div className="max-h-52 overflow-y-auto p-2">
            {/* Legacy out-of-range slot (edit mode for old lessons) */}
            {hasLegacy && legacySlot && (
              <div className="mb-1.5 pb-1.5 border-b border-amber-100">
                <button
                  type="button"
                  onClick={() => { onChange(legacySlot); setOpen(false); }}
                  className={[
                    "w-full px-3 py-1.5 text-sm rounded-lg text-center transition-colors",
                    value === legacySlot
                      ? "bg-brand-600 text-white font-medium"
                      : "text-amber-700 bg-amber-50 hover:bg-amber-100",
                  ].join(" ")}
                >
                  {legacySlot}
                </button>
              </div>
            )}

            {/* Regular slots — 2 columns: HH:00 | HH:30 per row */}
            <div className="grid grid-cols-2 gap-1">
              {visibleSlots.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => { onChange(slot); setOpen(false); }}
                  className={[
                    "px-2 py-1.5 text-sm rounded-lg text-center transition-colors",
                    value === slot
                      ? "bg-brand-600 text-white font-medium"
                      : "text-gray-700 hover:bg-brand-50 hover:text-brand-700",
                  ].join(" ")}
                >
                  {slot}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LessonFormModal({
  mode,
  initialStudentId,
  initialStudentName,
  existingGroup,
  onClose,
  onSuccess,
}: LessonFormModalProps) {
  const t = useT();
  const qc = useQueryClient();
  const isEdit = mode === "edit";

  // ── form state ──────────────────────────────────────────────────────────────
  const [studentId, setStudentId] = useState(
    existingGroup?.student_id ?? initialStudentId ?? ""
  );
  const [date, setDate] = useState(existingGroup?.date ?? "");
  const [startTime, setStartTime] = useState(existingGroup?.start_time ?? "");
  const [duration, setDuration] = useState<Duration>(
    existingGroup
      ? inferDuration(existingGroup.start_time, existingGroup.end_time)
      : 60
  );
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  // course_id for the lesson; pre-filled in edit mode, auto-set for 1-course students.
  const [courseId, setCourseId] = useState<string>(
    existingGroup?.course_id ?? ""
  );

  // ── student list (create mode only) ────────────────────────────────────────
  const { data: students = [] } = useQuery<StudentOption[]>({
    queryKey: ["students"],
    queryFn: () => api.get("/students"),
    // Don't fetch if student is already fixed
    enabled: !isEdit && !initialStudentId,
  });

  // ── student courses — used for course picker ────────────────────────────────
  // Fetch the student detail to get their enrolled courses.
  // refetchOnMount: "always" overrides the global default of false — we need
  // fresh data every time the modal opens because the global React Query config
  // (providers.tsx) disables refetch-on-mount to avoid loading flashes on page
  // navigation, but the course list must reflect the latest DB state.
  const { data: studentDetail } = useQuery<{
    courses?: { id: string; name: string }[];
  }>({
    queryKey: ["students", studentId],
    queryFn: () => api.get(`/students/${studentId}`),
    enabled: !!studentId,
    refetchOnMount: "always",
    staleTime: 0,
  });
  const studentCourses = studentDetail?.courses ?? [];

  // Auto-select when the student has exactly one enrolled course and no course
  // has been chosen yet. Functional updater avoids adding courseId to the deps
  // array (which would cause an update loop when courseId becomes non-empty).
  useEffect(() => {
    if (studentCourses.length === 1) {
      setCourseId((prev) => prev || studentCourses[0]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentCourses]);

  // ── Archived-course detection (edit mode) ───────────────────────────────────
  // If a future lesson references a course that was archived after it was
  // scheduled, the active-courses list won't contain that course_id. Without
  // intervention, the picker stays hidden (or auto-picks the only active
  // course) and the silently-carried archived course_id would flow through to
  // the PATCH unchanged. Force a re-selection instead.
  const originalCourseId = existingGroup?.course_id ?? null;
  const courseListLoaded = studentDetail !== undefined;
  const originalCourseIsArchived =
    isEdit &&
    !!originalCourseId &&
    courseListLoaded &&
    !studentCourses.some((c) => c.id === originalCourseId);

  // Clear the stale archived course_id from form state once we know the list.
  // Runs at most once per modal open — `courseListLoaded` flips false→true.
  useEffect(() => {
    if (originalCourseIsArchived) {
      setCourseId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalCourseIsArchived]);

  // Resolved display name — either from the students list or from the prop.
  const fixedStudentName =
    existingGroup?.student_name ??
    initialStudentName ??
    students.find((s) => s.id === studentId)?.full_name;

  // ── Booking error → i18n mapper ─────────────────────────────────────────────
  // The backend returns raw English strings. Map known messages to i18n keys so
  // the UI always displays localised text. Unmapped messages fall back to the
  // raw string (safe: better than swallowing the error entirely).
  function mapBookingError(msg: string): string {
    if (msg.includes("Teacher has a conflicting booking"))
      return t("teacher.conflictingTeacherBooking");
    if (msg.includes("Student has a conflicting booking"))
      return t("teacher.conflictingStudentBooking");
    if (msg.includes("Course is not assigned to this student"))
      return t("teacher.courseNotAssigned");
    return msg;
  }

  // ── mutations ───────────────────────────────────────────────────────────────
  // Create flow uses an optimistic UI: the modal closes immediately, the
  // schedule shows the new lesson with a "⏳ מסתנכרן ליומן…" badge, and the
  // real DB response (still 3-4s on cold paths) refetches and replaces the
  // temp rows transparently. On error we restore the snapshot and surface
  // a clear alert — the form is gone (modal already closed), so the user
  // has to reopen it; that trade-off is acceptable for the rare error path.
  const createMutation = useMutation({
    mutationFn: () =>
      api.post("/bookings/teacher-lesson", {
        student_id: studentId,
        date,
        start_time: startTime,
        duration_minutes: duration,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(courseId ? { course_id: courseId } : {}),
      }),
    onMutate: async () => {
      const bookingsKey = ["my-bookings-as-teacher"] as const;
      // Cancel any concurrent refetch so it can't overwrite our optimistic
      // snapshot mid-mutation.
      await qc.cancelQueries({ queryKey: bookingsKey });

      const snapshot = qc.getQueryData<OptimisticBookingRow[]>(bookingsKey);

      // Build one temp row per 30-min slot. Consecutive end_time→start_time
      // and matching student/date/status/gcal_event_id=null/course_id let
      // `groupConsecutiveBookings` collapse them into a single visible lesson.
      const tempPrefix = `temp-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const slotCount = duration / 30;
      const nowIso = new Date().toISOString();
      const studentName = fixedStudentName ?? "";
      const tempRows: OptimisticBookingRow[] = [];
      for (let i = 0; i < slotCount; i++) {
        tempRows.push({
          id: `${tempPrefix}-${i}`,
          date,
          start_time: addMin(startTime, i * 30),
          end_time: addMin(startTime, (i + 1) * 30),
          status: "approved",
          student_note: null,
          teacher_note: note.trim() ? note.trim() : null,
          attendance: null,
          student_name: studentName,
          student_id: studentId,
          created_at: nowIso,
          course_id: courseId || null,
          gcal_event_id: null,
          calendar_sync_status: "pending",
        });
      }

      qc.setQueryData<OptimisticBookingRow[]>(bookingsKey, (prev) => [
        ...tempRows,
        ...(prev ?? []),
      ]);

      // Close the modal immediately — the rest of the work happens in the
      // background and is reflected by the temp rows we just inserted.
      onClose();

      return { snapshot };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-bookings-as-teacher"] });
      // A teacher-created lesson also creates a lesson session + affects the
      // student's learning map and availability/booking slots.
      qc.invalidateQueries({ queryKey: ["lessons"] });
      qc.invalidateQueries({ queryKey: ["learning-map"] });
      qc.invalidateQueries({ queryKey: ["my-availability"] });
      qc.invalidateQueries({ queryKey: ["booking-slots"] });
      onSuccess();
      // NOTE: onClose() already fired in onMutate — don't call it again.
    },
    onError: (err: Error, _vars, context) => {
      // Roll back the optimistic insert by restoring the previous cache.
      // Then surface the error: the modal is already unmounted, so we can
      // no longer use setFormError — use a plain alert with the i18n-mapped
      // message.
      const bookingsKey = ["my-bookings-as-teacher"] as const;
      if (context?.snapshot !== undefined) {
        qc.setQueryData(bookingsKey, context.snapshot);
      } else {
        // No prior snapshot (cache was empty) — strip just the temp rows.
        qc.setQueryData<OptimisticBookingRow[]>(bookingsKey, (prev) =>
          (prev ?? []).filter((r) => !r.id.startsWith("temp-"))
        );
      }
      window.alert(mapBookingError(err.message));
    },
  });

  const editMutation = useMutation({
    mutationFn: () =>
      api.patch("/bookings/teacher-lesson", {
        booking_ids: existingGroup!.ids,
        date,
        start_time: startTime,
        duration_minutes: duration,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(courseId ? { course_id: courseId } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-bookings-as-teacher"] });
      // A teacher-created lesson also creates a lesson session + affects the
      // student's learning map and availability/booking slots.
      qc.invalidateQueries({ queryKey: ["lessons"] });
      qc.invalidateQueries({ queryKey: ["learning-map"] });
      qc.invalidateQueries({ queryKey: ["my-availability"] });
      qc.invalidateQueries({ queryKey: ["booking-slots"] });
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setFormError(mapBookingError(e.message)),
  });

  const isPending = createMutation.isPending || editMutation.isPending;

  // ── Israel time helpers ─────────────────────────────────────────────────────
  // Computed fresh on each render so minTime stays accurate as the date
  // field changes (and across midnight if the modal is left open).
  const { date: israelToday, time: israelNow } = getIsraelNow();
  // Show only future times when the teacher picks today's date.
  const minTime = date === israelToday ? israelNow : undefined;

  // ── submit ──────────────────────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    // Validate half-hour boundary
    const [, mm = ""] = startTime.split(":");
    if (mm !== "00" && mm !== "30") {
      setFormError(t("teacher.invalidStartTime"));
      return;
    }

    // Validate date is not in the past
    const { date: nowDate, time: nowTime } = getIsraelNow();
    if (date < nowDate) {
      setFormError(t("teacher.pastDateError"));
      return;
    }
    // Validate start time is not in the past (relevant only when date is today)
    if (date === nowDate && startTime <= nowTime) {
      setFormError(t("teacher.pastTimeError"));
      return;
    }

    // Validate course selection when the student has multiple enrolled courses.
    // Single-course students are auto-selected silently; no-course students are
    // allowed to proceed without a course_id.
    if (studentCourses.length >= 2 && !courseId) {
      setFormError(t("teacher.courseRequired"));
      return;
    }
    // If the lesson's original course was archived, force the teacher to pick
    // an active one — do not silently carry the archived id forward.
    if (originalCourseIsArchived && !courseId) {
      setFormError(t("teacher.courseArchivedReselect"));
      return;
    }

    if (isEdit) editMutation.mutate();
    else createMutation.mutate();
  }

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog
          - max-h-[90vh] + flex-col + overflow-hidden keeps the modal inside
            the viewport on short mobile screens (URL bar, landscape, etc.).
            The form inside gets overflow-y-auto so long forms scroll
            internally instead of being clipped.
          - max-w-md keeps the desktop width; on mobile the modal occupies
            full width minus the parent's p-4. */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <CalendarCheck size={18} className="text-brand-600" />
            <h2 className="text-base font-semibold text-gray-800">
              {isEdit
                ? t("teacher.editLessonTitle")
                : t("teacher.scheduleLessonTitle")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors rounded-md p-0.5 hover:bg-gray-100"
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </div>

        {/* Form — scrolls internally on short screens; px-4 on mobile keeps
            inputs from feeling cramped against the modal edges. */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-6 py-5 space-y-4">
          {/* Student */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t("teacher.student")}
            </label>

            {/* Locked: edit mode or create-from-student-page */}
            {isEdit || initialStudentId ? (
              <div className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-gray-50">
                {fixedStudentName ?? "—"}
              </div>
            ) : (
              <select
                required
                value={studentId}
                onChange={(e) => {
                  setStudentId(e.target.value);
                  // Reset course selection when switching students so the new
                  // student's courses can be auto-selected or manually chosen.
                  setCourseId("");
                }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200"
              >
                <option value="">{t("teacher.selectStudent")}</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Course picker — visible when:
              - student has ≥2 enrolled active courses, OR
              - the lesson's original course was archived (force re-select)
              Single-active-course students are auto-selected silently.
              Students with no courses skip this field entirely. */}
          {(studentCourses.length >= 2 || originalCourseIsArchived) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {t("teacher.courseLabel")}
              </label>
              {originalCourseIsArchived && (
                <p className="mb-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {t("teacher.courseArchivedReselect")}
                </p>
              )}
              <select
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200"
              >
                <option value="">{t("teacher.coursePlaceholder")}</option>
                {studentCourses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t("teacher.date")}
            </label>
            <input
              type="date"
              required
              value={date}
              min={israelToday}
              onChange={(e) => {
                const newDate = e.target.value;
                // Defense in depth: some mobile browsers (notably Safari iOS)
                // don't reliably enforce the HTML `min` attribute on
                // <input type="date">. Reject past dates client-side here,
                // before they ever land in state. handleSubmit also re-checks
                // as a final guard if anything slips through.
                if (newDate && newDate < israelToday) {
                  setFormError(t("teacher.pastDateError"));
                  return;
                }
                // Clear any prior past-date error when a valid date is picked.
                if (formError === t("teacher.pastDateError")) setFormError(null);
                // When switching to today, a startTime carried over from the
                // previous (future) date may now be in the past. Reset it so the
                // teacher is forced to pick a still-future slot instead of hitting
                // a confusing "time has already passed" error on save. The
                // TimeSelect dropdown already hides past slots via `minTime`.
                if (newDate === israelToday && startTime && startTime <= israelNow) {
                  setStartTime("");
                  // Drop a stale past-time error if one was showing.
                  if (formError === t("teacher.pastTimeError")) setFormError(null);
                }
                setDate(newDate);
              }}
              // appearance-none + bg-white strip Safari iOS's native pill-style
              // gray background that otherwise leaks over the surrounding input
              // box. min-h-[42px] matches the visual height of the other inputs
              // so the field doesn't look smaller before a value is picked.
              // [text-align] keeps the rendered date aligned to the start
              // of the input in both RTL and LTR.
              className="w-full appearance-none bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-start min-h-[42px] focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200"
            />
          </div>

          {/* Start time */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t("teacher.startTime")}
            </label>
            <TimeSelect
              value={startTime}
              onChange={setStartTime}
              placeholder={t("teacher.selectTime")}
              legacySlot={existingGroup?.start_time}
              minTime={minTime}
            />
          </div>

          {/* Duration — pill toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t("teacher.lessonDuration")}
            </label>
            <div className="flex gap-2 flex-wrap">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(d)}
                  className={
                    duration === d
                      ? "px-3 py-1.5 rounded-lg text-sm font-medium bg-brand-600 text-white border border-brand-600"
                      : "px-3 py-1.5 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:border-brand-300 hover:bg-brand-50 transition-colors"
                  }
                >
                  {t(DURATION_KEYS[d])}
                </button>
              ))}
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t("teacher.addNote")}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200 resize-none"
            />
          </div>

          {/* Error */}
          {formError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {formError}
            </p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-lg transition-colors"
            >
              {t("common.cancel")}
            </button>
            <Button type="submit" disabled={isPending}>
              {isPending ? t("teacher.saving") : t("teacher.save")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
