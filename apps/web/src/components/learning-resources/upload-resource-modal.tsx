"use client";

import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { learningResourcesApi } from "@/lib/api";
import type { LearningResourceVisibility } from "@studiq/types";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export interface TopicOption {
  id: string;
  name: string;
  /** Indent level for nested rendering — 0 = root, 1 = subtopic. */
  depth?: number;
}

interface Props {
  courseId: string;
  /** Optional list to populate the scope dropdown. When empty: course-only. */
  topics?: TopicOption[];
  /** Pre-select this topic in the dropdown. */
  defaultTopicId?: string | null;
  onClose: () => void;
}

export function UploadResourceModal({
  courseId,
  topics = [],
  defaultTopicId = null,
  onClose,
}: Props) {
  const t = useT();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [topicId, setTopicId] = useState<string | "">(defaultTopicId ?? "");
  const [visibility, setVisibility] =
    useState<LearningResourceVisibility>("teacher_only");
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: () => {
      if (!file) throw new Error(t("resources.fileRequired"));
      return learningResourcesApi.upload(file, {
        course_id: courseId,
        topic_id: topicId || null,
        title: title.trim(),
        description: description.trim() || null,
        visibility,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["learning-resources"] });
      onClose();
    },
    onError: (err) => {
      setError((err as Error).message || t("resources.uploadError"));
    },
  });

  const isValid = useMemo(() => {
    if (!title.trim()) return false;
    if (!file) return false;
    return true;
  }, [title, file]);

  function handleFile(f: File | null) {
    setError(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setError(t("resources.fileTooLarge"));
      return;
    }
    if (!ALLOWED_TYPES.has(f.type)) {
      setError(t("resources.invalidFileType"));
      return;
    }
    setFile(f);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">
            {t("resources.uploadTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label={t("resources.cancel")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              {t("resources.titleLabel")}
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={255}
              placeholder={t("resources.titlePlaceholder")}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              {t("resources.descriptionLabel")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder={t("resources.descriptionPlaceholder")}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              {t("resources.fileLabel")}
            </label>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-gray-700 hover:file:bg-gray-200"
            />
            {file && (
              <div className="text-[11px] text-gray-500 mt-1 truncate">
                {file.name} · {Math.round(file.size / 1024)} KB
              </div>
            )}
          </div>

          {topics.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                {t("resources.scopeLabel")}
              </label>
              <select
                value={topicId}
                onChange={(e) => setTopicId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
              >
                <option value="">{t("resources.scopeWholeCourse")}</option>
                {topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.depth ? "— " : ""}
                    {topic.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              {t("resources.visibilityLabel")}
            </label>
            <div className="flex flex-col gap-1.5 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="vis"
                  checked={visibility === "teacher_only"}
                  onChange={() => setVisibility("teacher_only")}
                />
                {t("resources.visibilityTeacher")}
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="vis"
                  checked={visibility === "student_visible"}
                  onChange={() => setVisibility("student_visible")}
                />
                {t("resources.visibilityStudent")}
              </label>
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <Button variant="ghost" onClick={onClose} disabled={upload.isPending}>
            {t("resources.cancel")}
          </Button>
          <Button
            onClick={() => upload.mutate()}
            disabled={!isValid || upload.isPending}
          >
            {upload.isPending ? "…" : t("resources.submit")}
          </Button>
        </div>
      </div>
    </div>
  );
}
