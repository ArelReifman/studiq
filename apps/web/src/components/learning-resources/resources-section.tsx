"use client";

import { useMemo, useState } from "react";
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
  /** Teacher view only: when set, the section is scoped to a specific
   *  student. The list returns shared course resources + that student's
   *  private resources; uploads default to that student. */
  studentId?: string | null;
}

type TeacherProps = BaseProps & { role: "teacher" };
type StudentProps = BaseProps & { role: "student" };
type Props = TeacherProps | StudentProps;

export function ResourcesSection(props: Props) {
  const t = useT();
  const qc = useQueryClient();
  const {
    courseId,
    topicId,
    role,
    topics = [],
    variant = "panel",
    studentId = null,
  } = props;
  const [showUpload, setShowUpload] = useState(false);

  const queryKey = [
    "learning-resources",
    role,
    {
      course_id: courseId,
      topic_id: topicId ?? null,
      student_id: studentId ?? null,
    },
  ] as const;

  // The Learning Map renders this section at the *parent* topic level, but
  // resources can be attached to child subtopics too. So whenever a topic is in
  // scope we fetch the whole course/student scope (no topic_id sent to the API)
  // and filter client-side to this parent's subtree below. The query key stays
  // scoped by topicId so each parent topic keeps its own cache entry.
  const { data: resources, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      role === "teacher"
        ? learningResourcesApi.listForTeacher(
            courseId,
            undefined,
            studentId ?? undefined
          )
        : learningResourcesApi.listForStudent(courseId, undefined),
    enabled: !!courseId,
  });

  // topic_id → display name, built from the topics passed by the parent (the
  // active topic + its children). Used to badge each resource.
  const topicNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const tp of topics) m.set(tp.id, tp.name);
    return m;
  }, [topics]);

  // When a topic is in scope, show only this parent's subtree (parent + its
  // children) plus course-level resources (topic_id === null). In the course
  // tab (no topicId) we leave the list untouched.
  const visibleResources = useMemo(() => {
    if (!resources || !topicId) return resources;
    const allowed = new Set<string>([topicId, ...topics.map((tp) => tp.id)]);
    return resources.filter(
      (r) => r.topic_id === null || allowed.has(r.topic_id)
    );
  }, [resources, topicId, topics]);

  const topicLabelFor = (topicId: string | null): string | null =>
    topicId === null
      ? t("resources.scopeCourseLevel")
      : topicNameById.get(topicId) ?? null;

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
      ) : !visibleResources || visibleResources.length === 0 ? (
        <div className="text-xs text-gray-400 px-1">
          {role === "teacher"
            ? t("resources.empty")
            : t("resources.emptyStudent")}
        </div>
      ) : (
        <div className="space-y-1.5">
          {visibleResources.map((r: LearningResource) => (
            <ResourceItem
              key={r.id}
              resource={r}
              canManage={role === "teacher"}
              topicLabel={topicLabelFor(r.topic_id)}
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
          studentId={studentId ?? null}
          onClose={() => setShowUpload(false)}
        />
      )}
    </section>
  );
}
