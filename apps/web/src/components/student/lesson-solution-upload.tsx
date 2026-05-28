"use client";

/**
 * Lesson-level "your solution" upload card. Sits below the teacher's
 * lesson material on the student lesson page so the student can upload
 * a single PDF / image with their answers and the teacher can see it on
 * their side without exchanging messages.
 *
 * Independent of per-task homework attachments (those still live on
 * each individual task).
 */
import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload, X, Paperclip } from "lucide-react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { useT } from "@/i18n";

interface Props {
  lessonId: string;
  solutionUrl: string | null;
  solutionName: string | null;
}

export function LessonSolutionUpload({
  lessonId,
  solutionUrl,
  solutionName,
}: Props) {
  const t = useT();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isRemoving = useRef(false);

  const upload = useMutation({
    mutationFn: (file: File) =>
      api.uploadDirect<{ student_solution_url: string; student_solution_name: string }>(
        `/upload/lesson/${lessonId}/solution/sign`,
        `/upload/lesson/${lessonId}/solution/confirm`,
        file
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lessons", lessonId] });
      qc.invalidateQueries({ queryKey: ["lessons"] });
      // Uploading a solution flips tasks to pending and affects teacher views.
      qc.invalidateQueries({ queryKey: ["learning-map"] });
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["todos"] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/upload/lesson/${lessonId}/solution`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lessons", lessonId] });
      qc.invalidateQueries({ queryKey: ["lessons"] });
    },
    onSettled: () => {
      isRemoving.current = false;
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const hasSolution = !!solutionUrl;

  return (
    <Card className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <Paperclip size={16} className="text-brand-500" />
        <h2 className="text-base font-semibold">{t("student.yourSolution")}</h2>
      </div>
      <p className="text-xs text-gray-400 mb-3">{t("student.solutionHint")}</p>

      {hasSolution ? (
        <div className="flex items-center gap-2 bg-gray-50 rounded-md px-3 py-2">
          <FileText size={16} className="text-brand-500 flex-shrink-0" />
          <a
            href={solutionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-brand-600 hover:underline truncate flex-1"
          >
            {solutionName || t("student.yourSolution")}
          </a>
          <button
            onClick={() => {
              if (isRemoving.current) return;
              isRemoving.current = true;
              remove.mutate();
            }}
            disabled={remove.isPending}
            className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0 disabled:opacity-50"
            title={t("upload.remove")}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/jpeg,image/png,image/webp"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={upload.isPending}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-brand-500 border border-dashed border-gray-300 rounded-lg px-4 py-3 w-full justify-center transition-colors disabled:opacity-50"
          >
            {upload.isPending ? (
              <>
                <Upload size={16} className="animate-pulse" />
                {t("upload.uploading")}
              </>
            ) : (
              <>
                <Upload size={16} />
                {t("student.uploadSolution")}
              </>
            )}
          </button>
        </>
      )}

      {upload.isError && (
        <p className="text-xs text-red-500 mt-2">{upload.error.message}</p>
      )}
      {remove.isError && (
        <p className="text-xs text-red-500 mt-2">{remove.error.message}</p>
      )}
    </Card>
  );
}
