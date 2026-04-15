"use client";

import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Circle, Paperclip, FileText, X, Upload } from "lucide-react";
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryKey = type === "homework" ? ["homework", lessonId] : ["todos", lessonId];
  const lessonQueryKey = ["lessons", lessonId];

  const { mutate, isPending } = useMutation({
    mutationFn: (status: "completed" | "failed") =>
      api.patch(`/${type === "homework" ? "homework" : "todos"}/${item.id}/mark`, {
        status,
      }),
    onMutate: async (status) => {
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
      qc.invalidateQueries({ queryKey: lessonQueryKey });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      api.uploadDirect<{ file_url: string; file_name: string }>(
        `/upload/homework/${item.id}/sign`,
        `/upload/homework/${item.id}/confirm`,
        file
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: lessonQueryKey });
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => api.delete(`/upload/homework/${item.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: lessonQueryKey });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadMutation.mutate(file);
    }
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const isPending_ = item.status === "pending";
  const isCompleted = item.status === "completed";
  const isFailed = item.status === "failed";

  // Only homework items have file fields
  const isHomework = type === "homework";
  const hwItem = isHomework ? (item as HomeworkItem) : null;
  const hasFile = hwItem?.file_url && hwItem?.file_name;

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

        {/* File attachment display */}
        {isHomework && hasFile && (
          <div className="flex items-center gap-2 mt-2 bg-gray-50 rounded-md px-2.5 py-1.5 w-fit">
            <FileText size={14} className="text-brand-500 flex-shrink-0" />
            <a
              href={hwItem!.file_url!}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-brand-600 hover:underline truncate max-w-[200px]"
            >
              {hwItem!.file_name}
            </a>
            <button
              onClick={() => removeMutation.mutate()}
              disabled={removeMutation.isPending}
              className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
              title={t("upload.remove")}
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Upload button for homework without file */}
        {isHomework && !hasFile && (
          <div className="mt-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/jpeg,image/png,image/webp"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-brand-500 transition-colors disabled:opacity-50"
            >
              {uploadMutation.isPending ? (
                <>
                  <Upload size={13} className="animate-pulse" />
                  {t("upload.uploading")}
                </>
              ) : (
                <>
                  <Paperclip size={13} />
                  {t("upload.attachFile")}
                </>
              )}
            </button>
            {uploadMutation.isError && (
              <p className="text-xs text-red-500 mt-1">
                {uploadMutation.error.message}
              </p>
            )}
          </div>
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
