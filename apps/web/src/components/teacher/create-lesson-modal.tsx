"use client";

import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Plus, Trash2, Upload, FileText } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import type { Course, CourseWithTopics } from "@studiq/types";

interface CreateLessonModalProps {
  studentId: string;
  onClose: () => void;
  /**
   * Pre-fill the topic when the modal is opened from a specific learning
   * map card. Without this, the teacher has to re-pick the topic and a
   * misclick creates a lesson on the wrong row in the map. The course is
   * inferred from the topic on the server side; we still pre-fill it here
   * so the dropdowns display the right selection.
   */
  initialTopicId?: string;
  initialCourseId?: string;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CreateLessonModal({
  studentId,
  onClose,
  initialTopicId,
  initialCourseId,
}: CreateLessonModalProps) {
  const t = useT();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  // If the teacher hasn't typed a custom title, we keep auto-filling from the topic.
  const [titleAutoFilled, setTitleAutoFilled] = useState(true);
  const [tasks, setTasks] = useState<{ title: string; description: string }[]>([
    { title: "", description: "" },
  ]);
  const [file, setFile] = useState<File | null>(null);
  const [courseId, setCourseId] = useState<string>(initialCourseId ?? "");
  const [topicId, setTopicId] = useState<string>(initialTopicId ?? "");
  const { data: courses = [] } = useQuery<Course[]>({
    queryKey: ["courses"],
    queryFn: () => api.get("/courses"),
  });

  const { data: courseDetail } = useQuery<CourseWithTopics>({
    queryKey: ["courses", courseId],
    queryFn: () => api.get(`/courses/${courseId}`),
    enabled: !!courseId,
  });

  // Reset topic when the teacher actively switches courses, but skip the
  // very first effect run so an initialTopicId passed in from the map
  // survives mount. Without this, the pre-filled topic would be wiped
  // before the user sees it.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    setTopicId("");
  }, [courseId]);

  // If the modal opened on a parent topic that has children, jump to
  // the first child — lessons should attach to a leaf (sub-topic), not
  // the umbrella, so the map's progress rolls up correctly. Runs once
  // courseDetail loads so we can see the children.
  const didResolveParent = useRef(false);
  useEffect(() => {
    if (didResolveParent.current) return;
    if (!courseDetail || !topicId) return;
    const isParent = courseDetail.topics.some(
      (tp) => tp.parent_topic_id === topicId
    );
    if (isParent) {
      const firstChild = courseDetail.topics
        .filter((tp) => tp.parent_topic_id === topicId)
        .sort((a, b) => a.order_index - b.order_index)[0];
      if (firstChild) {
        setTopicId(firstChild.id);
      }
    }
    didResolveParent.current = true;
  }, [courseDetail, topicId]);

  // Auto-fill the title from the selected topic (only if the teacher hasn't typed one manually)
  useEffect(() => {
    if (!titleAutoFilled) return;
    const topic = courseDetail?.topics.find((tp) => tp.id === topicId);
    if (topic) {
      setTitle(`${topic.name} — ${todayStr()}`);
    } else {
      setTitle("");
    }
  }, [topicId, courseDetail, titleAutoFilled]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const validTasks = tasks.filter((td) => td.title.trim());

      const lesson = await api.post<{ id: string }>("/lessons/create", {
        student_id: studentId,
        title: title.trim(),
        todos: validTasks.map((td) => ({
          title: td.title.trim(),
          description: td.description.trim() || undefined,
        })),
        course_id: courseId || null,
        topic_id: topicId || null,
      });

      // Upload material PDF if provided — direct to Supabase, bypassing Vercel's body limit.
      if (file && lesson.id) {
        try {
          await api.uploadDirect(
            `/upload/lesson/${lesson.id}/sign`,
            `/upload/lesson/${lesson.id}/confirm`,
            file
          );
        } catch (uploadErr) {
          try {
            await api.delete(`/lessons/${lesson.id}`);
          } catch {
            // swallow rollback error; surface the original upload error below
          }
          throw uploadErr;
        }
      }

      return lesson;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lessons"] });
      onClose();
    },
  });

  const addTask = () => setTasks([...tasks, { title: "", description: "" }]);
  const removeTask = (i: number) => setTasks(tasks.filter((_, idx) => idx !== i));
  const updateTask = (i: number, field: "title" | "description", value: string) => {
    const copy = [...tasks];
    copy[i] = { ...copy[i], [field]: value };
    setTasks(copy);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const isValid = title.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold">{t("createLesson.title")}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Course + topic (optional) */}
          {courses.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("createLesson.course")} {t("common.optional")}
                </label>
                <select
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">—</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("createLesson.topic")}
                </label>
                <select
                  value={topicId}
                  onChange={(e) => setTopicId(e.target.value)}
                  disabled={!courseId || !courseDetail}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-400"
                >
                  <option value="">—</option>
                  {/* Render parents and their sub-topics in groups so the
                      teacher can see which sub-topic belongs to which
                      parent and pick the leaf (sub-topic) directly — that
                      matches how lessons should be tied: to the leaf, not
                      the umbrella. Parents without children stay pickable. */}
                  {(() => {
                    const topics = courseDetail?.topics ?? [];
                    const parents = topics
                      .filter((tp) => !tp.parent_topic_id)
                      .sort((a, b) => a.order_index - b.order_index);
                    return parents.map((parent) => {
                      const children = topics
                        .filter((tp) => tp.parent_topic_id === parent.id)
                        .sort((a, b) => a.order_index - b.order_index);
                      if (children.length === 0) {
                        return (
                          <option key={parent.id} value={parent.id}>
                            {parent.name}
                            {parent.is_shared ? " ★" : ""}
                          </option>
                        );
                      }
                      return (
                        <optgroup key={parent.id} label={parent.name}>
                          {children.map((child) => (
                            <option key={child.id} value={child.id}>
                              {child.name}
                              {child.is_shared ? " ★" : ""}
                            </option>
                          ))}
                        </optgroup>
                      );
                    });
                  })()}
                </select>
              </div>
            </div>
          )}

          {/* Lesson title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("createLesson.lessonTitle")} *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleAutoFilled(false);
              }}
              placeholder={t("createLesson.titlePlaceholder")}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {titleAutoFilled && topicId && (
              <p className="text-xs text-gray-400 mt-1">
                {t("createLesson.titleAutoHint")}
              </p>
            )}
          </div>

          {/* Material upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("createLesson.material")} {t("common.optional")}
            </label>
            {file ? (
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <FileText size={16} className="text-brand-500 flex-shrink-0" />
                <span className="text-sm text-gray-700 truncate flex-1">{file.name}</span>
                <button
                  onClick={() => setFile(null)}
                  className="text-gray-400 hover:text-red-500"
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
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 text-sm text-gray-500 hover:text-brand-500 border border-dashed border-gray-300 rounded-lg px-4 py-3 w-full justify-center transition-colors"
                >
                  <Upload size={16} />
                  {t("createLesson.uploadMaterial")}
                </button>
              </>
            )}
          </div>

          {/* Tasks (single unified list) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">
                {t("createLesson.tasks")}
              </label>
              <button
                type="button"
                onClick={addTask}
                className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
              >
                <Plus size={14} /> {t("createLesson.addItem")}
              </button>
            </div>
            <div className="space-y-2">
              {tasks.map((td, i) => (
                <div key={i} className="flex gap-2">
                  <div className="flex-1 space-y-1">
                    <input
                      type="text"
                      value={td.title}
                      onChange={(e) => updateTask(i, "title", e.target.value)}
                      placeholder={t("createLesson.taskTitlePlaceholder", { n: i + 1 })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                    <input
                      type="text"
                      value={td.description}
                      onChange={(e) => updateTask(i, "description", e.target.value)}
                      placeholder={t("createLesson.taskDescPlaceholder")}
                      className="w-full border border-gray-100 rounded-lg px-3 py-1.5 text-xs text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                  {tasks.length > 1 && (
                    <button
                      onClick={() => removeTask(i)}
                      className="text-gray-300 hover:text-red-400 mt-2"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!isValid || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending
              ? t("createLesson.creating")
              : t("createLesson.create")}
          </Button>
          {createMutation.isError && (
            <p className="text-xs text-red-500 self-center">
              {createMutation.error.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
