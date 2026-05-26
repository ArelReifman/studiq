"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { learningResourcesApi } from "@/lib/api";
import { useT } from "@/i18n";
import { ResourceItem } from "./resource-item";
import { UploadResourceModal, type TopicOption } from "./upload-resource-modal";
import type { LearningResource } from "@studiq/types";

interface BaseProps {
  courseId: string;
  /** When set, the section is scoped to a single topic and the upload modal
   *  defaults to attaching to that topic. */
  topicId?: string | null;
  /** Reusable topic list passed to the upload modal's scope dropdown. */
  topics?: TopicOption[];
  /** Visual mode — affects spacing and header size. */
  variant?: "panel" | "tab";
}

type TeacherProps = BaseProps & { role: "teacher" };
type StudentProps = BaseProps & { role: "student" };
type Props = TeacherProps | StudentProps;

export function ResourcesSection(props: Props) {
  const t = useT();
  const qc = useQueryClient();
  const { courseId, topicId, role, topics = [], variant = "panel" } = props;
  const [showUpload, setShowUpload] = useState(false);

  const queryKey = [
    "learning-resources",
    role,
    { course_id: courseId, topic_id: topicId ?? null },
  ] as const;

  const { data: resources, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      role === "teacher"
        ? learningResourcesApi.listForTeacher(courseId, topicId ?? undefined)
        : learningResourcesApi.listForStudent(courseId, topicId ?? undefined),
    enabled: !!courseId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => learningResourcesApi.delete(id),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: ["learning-resources"] }),
  });

  const isTab = variant === "tab";

  return (
    <section
      className={isTab ? "space-y-3" : "space-y-2 pt-3 border-t border-gray-100"}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3
            className={
              isTab
                ? "text-sm font-semibold text-gray-800"
                : "text-[11px] font-bold tracking-wider uppercase text-gray-500"
            }
          >
            {t("resources.sectionTitle")}
          </h3>
          {isTab && (
            <p className="text-xs text-gray-500">
              {t("resources.sectionHint")}
            </p>
          )}
        </div>

        {role === "teacher" && (
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-md transition-colors flex-shrink-0"
          >
            <Plus size={12} />
            {isTab ? t("resources.uploadCta") : t("resources.uploadShort")}
          </button>
        )}
      </header>

      {isLoading ? (
        <div className="text-xs text-gray-400">…</div>
      ) : !resources || resources.length === 0 ? (
        <div className="text-xs text-gray-400 px-1">
          {role === "teacher"
            ? t("resources.empty")
            : t("resources.emptyStudent")}
        </div>
      ) : (
        <div className="space-y-1.5">
          {resources.map((r: LearningResource) => (
            <ResourceItem
              key={r.id}
              resource={r}
              canManage={role === "teacher"}
              onDelete={
                role === "teacher" ? (id) => deleteMutation.mutate(id) : undefined
              }
            />
          ))}
        </div>
      )}

      {showUpload && role === "teacher" && (
        <UploadResourceModal
          courseId={courseId}
          topics={topics}
          defaultTopicId={topicId ?? null}
          onClose={() => setShowUpload(false)}
        />
      )}
    </section>
  );
}
