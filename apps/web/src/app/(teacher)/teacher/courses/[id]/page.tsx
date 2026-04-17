"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2, Share2, GripVertical } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import type { CourseWithTopics, CourseTopic } from "@studiq/types";

export default function CourseDetailPage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const courseId = params.id;
  const qc = useQueryClient();

  const { data: course, isLoading } = useQuery<CourseWithTopics>({
    queryKey: ["courses", courseId],
    queryFn: () => api.get(`/courses/${courseId}`),
    enabled: !!courseId,
  });

  const [newTopic, setNewTopic] = useState("");
  const [newShared, setNewShared] = useState(false);

  const addTopic = useMutation({
    mutationFn: () =>
      api.post<CourseTopic>(`/courses/${courseId}/topics`, {
        name: newTopic.trim(),
        is_shared: newShared,
        order_index: course?.topics.length ?? 0,
      }),
    onSuccess: () => {
      setNewTopic("");
      setNewShared(false);
      qc.invalidateQueries({ queryKey: ["courses", courseId] });
    },
  });

  const toggleShared = useMutation({
    mutationFn: (topic: CourseTopic) =>
      api.patch(`/courses/${courseId}/topics/${topic.id}`, {
        is_shared: !topic.is_shared,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courses", courseId] }),
  });

  const deleteTopic = useMutation({
    mutationFn: (topicId: string) =>
      api.delete(`/courses/${courseId}/topics/${topicId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courses", courseId] }),
  });

  if (isLoading) return <div className="text-gray-400">{t("common.loading")}</div>;
  if (!course) return <div className="text-gray-500">{t("courses.notFound")}</div>;

  return (
    <div>
      <Link
        href="/teacher/courses"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-600 mb-4"
      >
        <ArrowLeft size={14} />
        {t("courses.backToList")}
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">{course.name}</h1>
        {course.description && (
          <p className="text-sm text-gray-500 mt-1">{course.description}</p>
        )}
      </div>

      <section className="bg-white border border-gray-100 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">{t("courses.topics")}</h2>
          <span className="text-xs text-gray-400">
            {t("courses.topicsCount", { count: course.topics.length })}
          </span>
        </div>

        {/* Add topic row */}
        <div className="flex items-center gap-2 mb-4 pb-4 border-b border-gray-100">
          <input
            type="text"
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTopic.trim()) addTopic.mutate();
            }}
            placeholder={t("courses.topicPlaceholder")}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <label className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap cursor-pointer">
            <input
              type="checkbox"
              checked={newShared}
              onChange={(e) => setNewShared(e.target.checked)}
              className="rounded"
            />
            {t("courses.shared")}
          </label>
          <Button
            size="sm"
            disabled={!newTopic.trim() || addTopic.isPending}
            onClick={() => addTopic.mutate()}
          >
            <Plus size={14} />
          </Button>
        </div>

        {course.topics.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            {t("courses.noTopics")}
          </p>
        ) : (
          <ul className="space-y-2">
            {course.topics.map((topic, i) => (
              <li
                key={topic.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 group"
              >
                <GripVertical size={14} className="text-gray-300" />
                <span className="text-xs text-gray-400 w-5">{i + 1}.</span>
                <span className="flex-1 text-sm text-gray-800">{topic.name}</span>
                <button
                  onClick={() => toggleShared.mutate(topic)}
                  className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded transition-colors ${
                    topic.is_shared
                      ? "bg-brand-50 text-brand-600"
                      : "text-gray-400 hover:text-gray-600"
                  }`}
                  title={t("courses.toggleSharedHint")}
                >
                  <Share2 size={12} />
                  {topic.is_shared ? t("courses.shared") : t("courses.unique")}
                </button>
                <button
                  onClick={() => {
                    if (confirm(t("courses.deleteTopicConfirm", { name: topic.name }))) {
                      deleteTopic.mutate(topic.id);
                    }
                  }}
                  className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-xs text-gray-400">{t("courses.sharedHint")}</p>
      </section>
    </div>
  );
}
