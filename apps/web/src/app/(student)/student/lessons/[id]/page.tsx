"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TaskItem } from "@/components/student/task-item";
import { formatDate } from "@/lib/utils";
import type { LessonWithItems } from "@studiq/types";
import { ArrowLeft, FileText, MessageSquare, Check } from "lucide-react";
import Link from "next/link";
import { useT } from "@/i18n";

export default function LessonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const qc = useQueryClient();

  const { data: lesson, isLoading } = useQuery<LessonWithItems>({
    queryKey: ["lessons", id],
    queryFn: () => api.get(`/lessons/${id}`),
  });

  const [reflection, setReflection] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  // Sync the textarea when server data arrives / changes
  useEffect(() => {
    if (lesson?.student_reflection !== undefined) {
      setReflection(lesson.student_reflection ?? "");
    }
  }, [lesson?.student_reflection]);

  const saveReflection = useMutation({
    mutationFn: () =>
      api.patch(`/lessons/${id}/reflection`, { reflection: reflection.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lessons", id] });
      qc.invalidateQueries({ queryKey: ["lessons"] });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    },
  });

  if (isLoading) return <div className="text-gray-400">{t("common.loading")}</div>;
  if (!lesson) return <div className="text-gray-400">{t("lessons.notFound")}</div>;

  const hasMaterial = !!lesson.material_url;
  const originalReflection = lesson.student_reflection ?? "";
  const isDirty = reflection.trim() !== originalReflection.trim();

  return (
    <div>
      <Link
        href="/student/lessons"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft size={14} className="rtl:rotate-180" /> {t("lessons.backToLessons")}
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <Badge variant="default" className="mb-2">
            {t(`status.${lesson.status}`)}
          </Badge>
          <h1 className="text-2xl font-bold">{lesson.title}</h1>
          {lesson.description && (
            <p className="text-gray-500 mt-1">{lesson.description}</p>
          )}
          <p className="text-xs text-gray-400 mt-2">
            {formatDate(lesson.generated_at)}
          </p>
        </div>
      </div>

      {/* Lesson material PDF */}
      {hasMaterial && (
        <Card className="mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
              <FileText size={18} className="text-brand-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-400 mb-0.5">
                {t("student.lessonMaterial")}
              </p>
              <a
                href={lesson.material_url!}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-brand-600 hover:underline truncate block"
              >
                {lesson.material_name || t("createLesson.material")}
              </a>
            </div>
          </div>
        </Card>
      )}

      {(lesson.homework_items.length > 0 || lesson.todo_items.length > 0) && (
        <div className="mb-6">
          <h2 className="text-base font-semibold mb-3">{t("student.tasks")}</h2>
          <div className="space-y-2">
            {/* Legacy homework items (older lessons) */}
            {lesson.homework_items.map((item) => (
              <TaskItem key={item.id} item={item} type="homework" lessonId={id} />
            ))}
            {lesson.todo_items.map((item) => (
              <TaskItem key={item.id} item={item} type="todo" lessonId={id} />
            ))}
          </div>
        </div>
      )}

      {/* Student reflection */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare size={16} className="text-brand-500" />
          <h2 className="text-base font-semibold">{t("student.reflection")}</h2>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          {t("student.reflectionHint")}
        </p>
        <textarea
          value={reflection}
          onChange={(e) => setReflection(e.target.value)}
          placeholder={t("student.reflectionPlaceholder")}
          rows={4}
          maxLength={2000}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-gray-400">
            {reflection.length}/2000
          </span>
          <div className="flex items-center gap-2">
            {justSaved && (
              <span className="inline-flex items-center gap-1 text-xs text-green-600">
                <Check size={12} /> {t("student.reflectionSaved")}
              </span>
            )}
            <Button
              size="sm"
              disabled={!isDirty || saveReflection.isPending}
              onClick={() => saveReflection.mutate()}
            >
              {saveReflection.isPending
                ? t("student.saving")
                : t("student.saveReflection")}
            </Button>
          </div>
        </div>
        {saveReflection.isError && (
          <p className="text-xs text-red-500 mt-2">
            {saveReflection.error.message}
          </p>
        )}
      </Card>
    </div>
  );
}
