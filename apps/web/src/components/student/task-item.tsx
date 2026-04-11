"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Circle } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import type { HomeworkItem, TodoItem } from "@studiq/types";

interface TaskItemProps {
  item: HomeworkItem | TodoItem;
  type: "homework" | "todo";
  lessonId: string;
}

export function TaskItem({ item, type, lessonId }: TaskItemProps) {
  const qc = useQueryClient();
  const t = useT();
  const queryKey = type === "homework" ? ["homework", lessonId] : ["todos", lessonId];

  const { mutate, isPending } = useMutation({
    mutationFn: (status: "completed" | "failed") =>
      api.patch(`/${type === "homework" ? "homework" : "todos"}/${item.id}/mark`, {
        status,
      }),
    onMutate: async (status) => {
      // Optimistic update
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData(queryKey);
      qc.setQueryData(queryKey, (old: typeof item[] = []) =>
        old.map((i) => (i.id === item.id ? { ...i, status } : i))
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      qc.setQueryData(queryKey, ctx?.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey });
    },
  });

  const isPending_ = item.status === "pending";
  const isCompleted = item.status === "completed";
  const isFailed = item.status === "failed";

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 rounded-lg border transition-colors",
        isCompleted && "bg-green-50 border-green-100",
        isFailed && "bg-red-50 border-red-100",
        isPending_ && "bg-white border-gray-100"
      )}
    >
      {/* Status icon */}
      <div className="mt-0.5 flex-shrink-0">
        {isCompleted && <CheckCircle2 size={20} className="text-green-500" />}
        {isFailed && <XCircle size={20} className="text-red-400" />}
        {isPending_ && <Circle size={20} className="text-gray-300" />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm font-medium",
            isCompleted && "text-green-700 line-through",
            isFailed && "text-red-600",
            isPending_ && "text-gray-800"
          )}
        >
          {item.title}
        </p>
        {"description" in item && item.description && (
          <p className="text-xs text-gray-500 mt-1">{item.description}</p>
        )}
      </div>

      {/* Actions — only show for pending items */}
      {isPending_ && (
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => mutate("completed")}
            disabled={isPending}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:opacity-50 transition-colors"
          >
            <CheckCircle2 size={13} />
            {t("student.markDone")}
          </button>
          <button
            onClick={() => mutate("failed")}
            disabled={isPending}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-red-400 text-white rounded-md hover:bg-red-500 disabled:opacity-50 transition-colors"
          >
            <XCircle size={13} />
            {t("student.markStuck")}
          </button>
        </div>
      )}
    </div>
  );
}
