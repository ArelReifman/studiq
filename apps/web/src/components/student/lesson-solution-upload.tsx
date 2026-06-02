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
import { useRef, useState } from "react";
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

  // Anti-flicker local state. The component is fed `solutionUrl`/`solutionName`
  // from the parent ["lessons", lessonId] query. After a successful upload the
  // mutation triggers a background refetch (plus the Realtime lesson_sessions
  // echo), but until the refreshed lesson data lands the props still say
  // "no solution", which would briefly flip the card back to the empty
  // upload state — the visible flicker. We hold the confirmed file locally so
  // the card shows the uploaded state immediately and stays put through the
  // refetch. Server props remain the source of truth (see effective* below).
  const [justUploaded, setJustUploaded] = useState<{
    url: string;
    name: string;
  } | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) =>
      api.uploadDirect<{ student_solution_url: string; student_solution_name: string }>(
        `/upload/lesson/${lessonId}/solution/sign`,
        `/upload/lesson/${lessonId}/solution/confirm`,
        file
      ),
    onSuccess: (data) => {
      // Show the uploaded file right away, before the refetch arrives.
      setJustUploaded({
        url: data.student_solution_url,
        name: data.student_solution_name,
      });
      // The confirm endpoint only updates this lesson's lesson_sessions row
      // (student_solution_url/name) — it does NOT touch tasks/homework/todos.
      // So refetching this single lesson is enough for the student's own view.
      // Cross-surface refresh (teacher map/student list) is handled by the
      // teacher's separate Realtime subscription, not by invalidating the
      // student's own cache here. Broad invalidations were redundant and
      // collided with the Realtime echo of this same write, causing repeated
      // GET /lessons/:id refetches and visible flicker.
      qc.invalidateQueries({ queryKey: ["lessons", lessonId] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/upload/lesson/${lessonId}/solution`),
    onSuccess: () => {
      // Drop the local override so the card follows the server (now empty).
      setJustUploaded(null);
      qc.invalidateQueries({ queryKey: ["lessons", lessonId] });
      qc.invalidateQueries({ queryKey: ["lessons"] });
    },
    onSettled: () => {
      isRemoving.current = false;
    },
  });

  // Server data wins once it arrives; the local fallback only covers the gap
  // between a successful upload and the refetch/Realtime echo catching up.
  const effectiveUrl = solutionUrl ?? justUploaded?.url ?? null;
  const effectiveName = solutionName ?? justUploaded?.name ?? null;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const hasSolution = !!effectiveUrl;

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
            href={effectiveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-brand-600 hover:underline truncate flex-1"
          >
            {effectiveName || t("student.yourSolution")}
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
