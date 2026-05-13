"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, CalendarCheck } from "lucide-react";
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

function generateTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 7; h <= 22; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 22) slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
}

const TIME_SLOTS = generateTimeSlots();

function timeToMin(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
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

  // ── student list (create mode only) ────────────────────────────────────────
  const { data: students = [] } = useQuery<StudentOption[]>({
    queryKey: ["students"],
    queryFn: () => api.get("/students"),
    // Don't fetch if student is already fixed
    enabled: !isEdit && !initialStudentId,
  });

  // Resolved display name — either from the students list or from the prop.
  const fixedStudentName =
    existingGroup?.student_name ??
    initialStudentName ??
    students.find((s) => s.id === studentId)?.full_name;

  // ── mutations ───────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: () =>
      api.post("/bookings/teacher-lesson", {
        student_id: studentId,
        date,
        start_time: startTime,
        duration_minutes: duration,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-bookings-as-teacher"] });
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const editMutation = useMutation({
    mutationFn: () =>
      api.patch("/bookings/teacher-lesson", {
        booking_ids: existingGroup!.ids,
        date,
        start_time: startTime,
        duration_minutes: duration,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-bookings-as-teacher"] });
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const isPending = createMutation.isPending || editMutation.isPending;

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

      {/* Dialog */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
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
                onChange={(e) => setStudentId(e.target.value)}
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

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t("teacher.date")}
            </label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200"
            />
          </div>

          {/* Start time */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t("teacher.startTime")}
            </label>
            <select
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200"
            >
              <option value="">{t("teacher.selectTime")}</option>
              {TIME_SLOTS.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
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
              {t("teacher.addNote")}{" "}
              <span className="text-gray-400 font-normal text-xs">
                {t("common.optional")}
              </span>
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
