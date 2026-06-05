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

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, RotateCw, ArrowUp, CheckCircle2, Sparkles } from "lucide-react";
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

  // Phase AI-0.5 — after a successful `repeat` review the modal stays open and
  // swaps the review action row for the "generate retry lesson" CTA. Other
  // decisions (next_level / next_topic) keep the original auto-close behaviour.
  const [showRetryCta, setShowRetryCta] = useState(false);

  // Shared invalidations for any write the review/retry can affect: lesson cards
  // (verdict + flipped task statuses), student AI profile, difficulties
  // (auto-resolved on next_level / next_topic), the learning map (topic progress
  // rolls up from tasks), and homework / todos.
  const invalidateReviewQueries = () => {
    qc.invalidateQueries({ queryKey: ["lessons"] });
    qc.invalidateQueries({ queryKey: ["students", lesson.student_id, "profile"] });
    qc.invalidateQueries({ queryKey: ["difficulties"] });
    qc.invalidateQueries({ queryKey: ["learning-map"] });
    qc.invalidateQueries({ queryKey: ["homework"] });
    qc.invalidateQueries({ queryKey: ["todos"] });
  };

  const submit = useMutation({
    mutationFn: () =>
      api.patch(`/lessons/${lesson.id}/review`, {
        teacher_decision: decision,
        teacher_review_note: note.trim() || undefined,
      }),
    onSuccess: () => {
      invalidateReviewQueries();
      // `repeat` keeps the modal open and reveals the retry CTA; the other
      // two decisions close immediately, exactly as before.
      if (decision === "repeat") {
        setShowRetryCta(true);
      } else {
        onClose();
      }
    },
  });

  // Phase AI-0.5 — generate a retry lesson for the same student / course / topic.
  // The backend reads the anchor from `retry_of_lesson_id`, enforces the
  // teacher_decision=repeat precondition and the duplicate-active guard.
  const retry = useMutation({
    mutationFn: () =>
      api.post("/lessons/generate", {
        student_id: lesson.student_id,
        retry_of_lesson_id: lesson.id,
      }),
    onSuccess: () => {
      // The retry archives the old lesson and creates a new active one, so the
      // same query set must refresh (lessons list, schedule, learning map).
      invalidateReviewQueries();
    },
  });

  // After a successful retry, show the success state briefly, then close.
  useEffect(() => {
    if (!retry.isSuccess) return;
    const timer = setTimeout(onClose, 1500);
    return () => clearTimeout(timer);
  }, [retry.isSuccess, onClose]);

  const canSubmit = !!decision && !submit.isPending;
  const retryPending = retry.isPending;

  // While a retry is generating, block every dismiss path (backdrop, X, footer)
  // so the teacher doesn't lose the success feedback — and, just as important,
  // so the component stays mounted until the mutation settles (an unmounted
  // observer would skip the onSuccess invalidations in react-query v5).
  const requestClose = () => {
    if (!retryPending) onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={requestClose}
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
            onClick={requestClose}
            disabled={retryPending}
            className="text-gray-400 hover:text-gray-600 p-1 disabled:opacity-40 disabled:cursor-not-allowed"
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
                  disabled={showRetryCta}
                  className={`w-full text-start border-2 rounded-lg p-3 transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
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
            disabled={showRetryCta}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60 disabled:bg-gray-50"
          />
          <p className="text-xs text-gray-400 mt-1">{t("lessonReview.noteHint")}</p>
        </div>

        {submit.isError && !showRetryCta && (
          <p className="text-sm text-red-500 mb-3">
            {submit.error instanceof Error
              ? submit.error.message
              : t("lessonReview.saveFailed")}
          </p>
        )}

        {/* Phase AI-0.5 — retry CTA, shown only after a successful `repeat`. */}
        {showRetryCta ? (
          <div>
            {retry.isSuccess ? (
              <div className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">
                <CheckCircle2 size={16} />
                <span>{t("lessonReview.retrySuccess")}</span>
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-700">
                  <CheckCircle2 size={16} />
                  <span>{t("lessonReview.repeatSaved")}</span>
                </div>
                <p className="mb-3 text-xs text-gray-500">
                  {t("lessonReview.retryHint")}
                </p>
                {retry.isError && (
                  <p className="mb-3 text-sm text-red-500">
                    {retry.error instanceof Error
                      ? retry.error.message
                      : t("lessonReview.retryFailed")}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    onClick={onClose}
                    disabled={retryPending}
                  >
                    {t("common.close")}
                  </Button>
                  <Button onClick={() => retry.mutate()} disabled={retryPending}>
                    <Sparkles size={16} className="me-1.5" />
                    {retryPending
                      ? t("lessonReview.generatingRetry")
                      : t("lessonReview.generateRetry")}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
}
