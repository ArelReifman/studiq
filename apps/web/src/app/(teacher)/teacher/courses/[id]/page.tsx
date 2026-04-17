"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Share2,
  ChevronUp,
  ChevronDown,
  Pencil,
  Check,
  X,
} from "lucide-react";
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

  // ─── Course header edit state ─────────────────────────────────────────────
  const [editingCourse, setEditingCourse] = useState(false);
  const [courseName, setCourseName] = useState("");
  const [courseDesc, setCourseDesc] = useState("");

  function startEditCourse() {
    if (!course) return;
    setCourseName(course.name);
    setCourseDesc(course.description ?? "");
    setEditingCourse(true);
  }

  const saveCourse = useMutation({
    mutationFn: () =>
      api.patch(`/courses/${courseId}`, {
        name: courseName.trim(),
        description: courseDesc.trim() || undefined,
      }),
    onSuccess: () => {
      setEditingCourse(false);
      qc.invalidateQueries({ queryKey: ["courses", courseId] });
      qc.invalidateQueries({ queryKey: ["courses"] });
    },
  });

  // ─── Topic state ──────────────────────────────────────────────────────────
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

  const patchTopic = useMutation({
    mutationFn: (args: {
      id: string;
      body: Partial<{
        name: string;
        description: string;
        is_shared: boolean;
        order_index: number;
        prerequisite_topic_ids: string[];
      }>;
    }) => api.patch(`/courses/${courseId}/topics/${args.id}`, args.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courses", courseId] }),
  });

  const deleteTopic = useMutation({
    mutationFn: (topicId: string) =>
      api.delete(`/courses/${courseId}/topics/${topicId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courses", courseId] }),
  });

  // ─── Inline topic edit state ──────────────────────────────────────────────
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  function startEditTopic(topic: CourseTopic) {
    setEditingTopicId(topic.id);
    setEditName(topic.name);
    setEditDesc(topic.description ?? "");
  }

  function cancelEditTopic() {
    setEditingTopicId(null);
    setEditName("");
    setEditDesc("");
  }

  function saveTopic(topic: CourseTopic) {
    patchTopic.mutate(
      {
        id: topic.id,
        body: {
          name: editName.trim(),
          description: editDesc.trim(),
        },
      },
      { onSuccess: cancelEditTopic }
    );
  }

  // ─── Reorder (up / down) ──────────────────────────────────────────────────
  function moveTopic(index: number, direction: -1 | 1) {
    if (!course) return;
    const target = index + direction;
    if (target < 0 || target >= course.topics.length) return;

    const a = course.topics[index];
    const b = course.topics[target];
    if (!a || !b) return;

    // Swap order_index on both — backend stores raw integers, so swap values.
    patchTopic.mutate({ id: a.id, body: { order_index: b.order_index } });
    patchTopic.mutate({ id: b.id, body: { order_index: a.order_index } });
  }

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

      {/* ─── Course header (editable) ───────────────────────────────────── */}
      <div className="mb-6">
        {editingCourse ? (
          <div className="space-y-2">
            <input
              type="text"
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              className="w-full text-2xl font-bold border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <textarea
              value={courseDesc}
              onChange={(e) => setCourseDesc(e.target.value)}
              rows={2}
              placeholder={t("courses.descriptionPlaceholder")}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!courseName.trim() || saveCourse.isPending}
                onClick={() => saveCourse.mutate()}
              >
                <Check size={14} className="me-1" />
                {t("common.save")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingCourse(false)}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="group flex items-start gap-2">
            <div className="flex-1">
              <h1 className="text-2xl font-bold">{course.name}</h1>
              {course.description && (
                <p className="text-sm text-gray-500 mt-1">{course.description}</p>
              )}
            </div>
            <button
              onClick={startEditCourse}
              className="text-gray-300 hover:text-brand-500 opacity-0 group-hover:opacity-100 transition-opacity mt-1"
              aria-label={t("common.edit")}
            >
              <Pencil size={16} />
            </button>
          </div>
        )}
      </div>

      {/* ─── Topics editor ──────────────────────────────────────────────── */}
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
            {course.topics.map((topic, i) => {
              const isEditing = editingTopicId === topic.id;
              return (
                <li
                  key={topic.id}
                  className="p-3 rounded-lg border border-gray-100 hover:bg-gray-50 group"
                >
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                      <input
                        type="text"
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        placeholder={t("courses.topicDescPlaceholder")}
                        className="w-full border border-gray-100 rounded-lg px-3 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={!editName.trim() || patchTopic.isPending}
                          onClick={() => saveTopic(topic)}
                        >
                          <Check size={14} />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEditTopic}>
                          <X size={14} />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      {/* Reorder */}
                      <div className="flex flex-col -my-1">
                        <button
                          onClick={() => moveTopic(i, -1)}
                          disabled={i === 0 || patchTopic.isPending}
                          className="text-gray-300 hover:text-brand-500 disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label={t("courses.moveUp")}
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() => moveTopic(i, 1)}
                          disabled={
                            i === course.topics.length - 1 || patchTopic.isPending
                          }
                          className="text-gray-300 hover:text-brand-500 disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label={t("courses.moveDown")}
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>

                      <span className="text-xs text-gray-400 w-5">{i + 1}.</span>
                      <div className="flex-1">
                        <p className="text-sm text-gray-800">{topic.name}</p>
                        {topic.description && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            {topic.description}
                          </p>
                        )}
                      </div>

                      <button
                        onClick={() =>
                          patchTopic.mutate({
                            id: topic.id,
                            body: { is_shared: !topic.is_shared },
                          })
                        }
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
                        onClick={() => startEditTopic(topic)}
                        className="text-gray-300 hover:text-brand-500 opacity-0 group-hover:opacity-100"
                        aria-label={t("common.edit")}
                      >
                        <Pencil size={14} />
                      </button>

                      <button
                        onClick={() => {
                          if (
                            confirm(
                              t("courses.deleteTopicConfirm", { name: topic.name })
                            )
                          ) {
                            deleteTopic.mutate(topic.id);
                          }
                        }}
                        className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                        aria-label={t("common.delete")}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-4 text-xs text-gray-400">{t("courses.sharedHint")}</p>
      </section>
    </div>
  );
}
