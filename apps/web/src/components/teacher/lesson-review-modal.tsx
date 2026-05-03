"use client";

/**
 * Lesson Review Modal — teacher records verdict after inspecting a student's
 * submitted solution. Three decisions: repeat / next_level / next_topic.
 * The verdict + optional note are sent to the AI so it learns the teacher's
 * grading standards over time.
 *
 * Additive: this component does not modify any existing UI. It opens via a
 * new button on the lesson card and writes only to fields added in
 * migration 013 (teacher_review_note, teacher_decision, teacher_reviewed_at).
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, RotateCw, ArrowUp, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import type { LessonSession, TeacherDecision } from "@studiq/types";

interface LessonReviewModalProps {
  lesson: LessonSession;
  onClose: () => void;
}

const DECISIONS: Array<{
  value: TeacherDecision;
  icon: typeof RotateCw;
  labelKey: string;
  hintKey: string;
  tone: "warning" | "info" | "success";
}> = [
  {
    value: "repeat",
    icon: RotateCw,
    labelKey: "lessonReview.repeat",
    hintKey: "lessonReview.repeatHint",
    tone: "warning",
  },
  {
    value: "next_level",
    icon: ArrowUp,
    labelKey: "lessonReview.nextLevel",
    hintKey: "lessonReview.nextLevelHint",
    tone: "info",
  },
  {
    value: "next_topic",
    icon: CheckCircle2,
    labelKey: "lessonReview.nextTopic",
    hintKey: "lessonReview.nextTopicHint",
    tone: "success",
  },
];

const TONE_CLASSES: Record<"warning" | "info" | "success", string> = {
  warning: "border-orange-300 bg-orange-50 text-orange-700",
  info: "border-brand-300 bg-brand-50 text-brand-700",
  success: "border-green-300 bg-green-50 text-green-700",
};

export function LessonReviewModal({ lesson, onClose }: LessonReviewModalProps) {
  const t = useT();
  const qc = useQueryClient();

  // Pre-fill from existing review (so opening the modal again shows last verdict)
  const [decision, setDecision] = useState<TeacherDecision | null>(
    lesson.teacher_decision ?? null
  );
  const [note, setNote] = useState<string>(lesson.teacher_review_note ?? "");

  const submit = useMutation({
    mutationFn: () =>
      api.patch(`/lessons/${lesson.id}/review`, {
        teacher_decision: decision,
        teacher_review_note: note.trim() || undefined,
      }),
    onSuccess: () => {
      // Invalidate all lesson queries so the card reflects the new verdict
      qc.invalidateQueries({ queryKey: ["lessons"] });
      qc.invalidateQueries({ queryKey: ["students", lesson.student_id, "profile"] });
      onClose();
    },
  });

  const canSubmit = !!decision && !submit.isPending;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">{t("lessonReview.title")}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{lesson.title}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1"
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </div>

        {/* Student reflection (read-only context) */}
        {lesson.student_reflection && (
          <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
            <p className="text-xs text-gray-400 mb-1">
              {t("lessonReview.studentSaid")}
            </p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {lesson.student_reflection}
            </p>
          </div>
        )}

        {/* Decision picker */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">
            {t("lessonReview.decisionLabel")}
          </label>
          <div className="space-y-2">
            {DECISIONS.map(({ value, icon: Icon, labelKey, hintKey, tone }) => {
              const selected = decision === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDecision(value)}
                  className={`w-full text-start border-2 rounded-lg p-3 transition-all ${
                    selected
                      ? TONE_CLASSES[tone]
                      : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon size={16} />
                    <span className="font-medium text-sm">{t(labelKey)}</span>
                  </div>
                  <p className="text-xs opacity-80 ms-6">{t(hintKey)}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Optional note */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">
            {t("lessonReview.noteLabel")}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("lessonReview.notePlaceholder")}
            rows={3}
            maxLength={2000}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <p className="text-xs text-gray-400 mt-1">{t("lessonReview.noteHint")}</p>
        </div>

        {submit.isError && (
          <p className="text-sm text-red-500 mb-3">
            {submit.error instanceof Error
              ? submit.error.message
              : t("lessonReview.saveFailed")}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submit.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={!canSubmit}
          >
            {submit.isPending ? t("lessonReview.saving") : t("lessonReview.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
