"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, ListChecks } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { useT } from "@/i18n";
import type { LessonWithItems } from "@studiq/types";

interface RetryChecklistProps {
  lesson: LessonWithItems;
}

/**
 * Teacher-only checklist derived from the review note they wrote before
 * generating this retry lesson. The lesson content itself is a duplicate of
 * the predecessor; this is the only new material and it's for the teacher to
 * track, not the student — mirrors how teacher_review_note already stays
 * teacher-side only.
 */
export function RetryChecklist({ lesson }: RetryChecklistProps) {
  const t = useT();
  const qc = useQueryClient();
  const queryKey = ["lessons", lesson.id];
  const items = lesson.retry_checklist ?? [];

  const { mutate } = useMutation({
    mutationFn: (vars: { index: number; done: boolean }) =>
      api.patch(`/lessons/${lesson.id}/checklist-item`, vars),
    onMutate: async ({ index, done }) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<LessonWithItems>(queryKey);
      qc.setQueryData<LessonWithItems>(queryKey, (old) =>
        old
          ? {
              ...old,
              retry_checklist: (old.retry_checklist ?? []).map((item, i) =>
                i === index ? { ...item, done } : item
              ),
            }
          : old
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
  });

  if (items.length === 0) return null;

  return (
    <Card className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <ListChecks size={16} className="text-brand-500" />
        <h2 className="text-base font-semibold">
          {t("retryChecklist.title")}
        </h2>
      </div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <button
            key={index}
            onClick={() => mutate({ index, done: !item.done })}
            className={cn(
              "w-full flex items-start gap-2.5 p-3 rounded-lg border text-start transition-colors",
              item.done
                ? "bg-green-50 border-green-100"
                : "bg-white border-gray-100 hover:border-gray-200"
            )}
          >
            <div className="mt-0.5 flex-shrink-0">
              {item.done ? (
                <CheckCircle2 size={18} className="text-green-500" />
              ) : (
                <Circle size={18} className="text-gray-300" />
              )}
            </div>
            <p
              className={cn(
                "text-sm",
                item.done ? "text-green-700 line-through" : "text-gray-700"
              )}
            >
              {item.text}
            </p>
          </button>
        ))}
      </div>
    </Card>
  );
}
