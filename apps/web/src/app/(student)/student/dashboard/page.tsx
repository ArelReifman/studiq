"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TaskItem } from "@/components/student/task-item";
import { formatDate } from "@/lib/utils";
import type { LessonSession, HomeworkItem, TodoItem } from "@studiq/types";
import { BookOpen, ArrowRight, FileText } from "lucide-react";

export default function StudentDashboard() {
  const user = useAuthStore((s) => s.user);
  const t = useT();

  const { data: lessons = [], isLoading } = useQuery<LessonSession[]>({
    queryKey: ["lessons"],
    queryFn: () => api.get("/lessons"),
  });

  const activeLesson = lessons.find((l) => l.status === "active") ?? lessons[0];

  const { data: homework = [] } = useQuery<HomeworkItem[]>({
    queryKey: ["homework", activeLesson?.id ?? ""],
    queryFn: () => api.get(`/homework?lesson_id=${activeLesson!.id}`),
    enabled: !!activeLesson,
  });

  const { data: todos = [] } = useQuery<TodoItem[]>({
    queryKey: ["todos", activeLesson?.id ?? ""],
    queryFn: () => api.get(`/todos?lesson_id=${activeLesson!.id}`),
    enabled: !!activeLesson,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        {t("common.loading")}
      </div>
    );
  }

  if (lessons.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <BookOpen size={48} className="text-brand-200 mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 mb-2">
          {t("student.firstLesson")}
        </h2>
        <p className="text-gray-500 text-sm">{t("student.firstLessonSub")}</p>
      </div>
    );
  }

  const completedHw = homework.filter((h) => h.status === "completed").length;
  const totalHw = homework.length;
  const completedTodos = todos.filter((td) => td.status === "completed").length;
  const totalTodos = todos.length;
  const progress =
    totalHw + totalTodos > 0
      ? Math.round(
          ((completedHw + completedTodos) / (totalHw + totalTodos)) * 100
        )
      : 0;

  const firstName = user?.full_name?.split(" ")[0] ?? "";

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">
        {t("student.welcomeBack", { name: firstName })}
      </h1>
      <p className="text-gray-500 mb-6">{t("student.currentLesson")}</p>

      {activeLesson && (
        <Card className="mb-6">
          <div className="flex items-start justify-between mb-3">
            <div>
              <Badge variant="default" className="mb-2">
                {t("student.activeLesson")}
              </Badge>
              <h2 className="text-lg font-semibold">{activeLesson.title}</h2>
              {activeLesson.description && (
                <p className="text-sm text-gray-500 mt-1">
                  {activeLesson.description}
                </p>
              )}
            </div>
            <span className="text-xs text-gray-400">
              {formatDate(activeLesson.generated_at)}
            </span>
          </div>

          {/* Material PDF link */}
          {activeLesson.material_url && (
            <div className="mt-3 flex items-center gap-2 bg-brand-50 rounded-lg px-3 py-2 w-fit">
              <FileText size={14} className="text-brand-500 flex-shrink-0" />
              <a
                href={activeLesson.material_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-brand-600 hover:underline truncate max-w-[300px]"
              >
                {activeLesson.material_name || t("createLesson.material")}
              </a>
            </div>
          )}

          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{t("student.progressLabel")}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-500 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </Card>
      )}

      {homework.length > 0 && (
        <div className="mb-6">
          <h3 className="text-base font-semibold mb-3">
            {t("student.homework")}
            <span className="text-sm font-normal text-gray-400 ms-2">
              {completedHw}/{totalHw} {t("student.done")}
            </span>
          </h3>
          <div className="space-y-2">
            {homework.map((item) => (
              <TaskItem
                key={item.id}
                item={item}
                type="homework"
                lessonId={activeLesson!.id}
              />
            ))}
          </div>
        </div>
      )}

      {todos.length > 0 && (
        <div className="mb-6">
          <h3 className="text-base font-semibold mb-3">
            {t("student.practiceTasks")}
            <span className="text-sm font-normal text-gray-400 ms-2">
              {completedTodos}/{totalTodos} {t("student.done")}
            </span>
          </h3>
          <div className="space-y-2">
            {todos.map((item) => (
              <TaskItem
                key={item.id}
                item={item}
                type="todo"
                lessonId={activeLesson!.id}
              />
            ))}
          </div>
        </div>
      )}

      <Link
        href="/student/lessons"
        className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline"
      >
        {t("student.viewHistory")}{" "}
        <ArrowRight size={14} className="rtl:rotate-180" />
      </Link>
    </div>
  );
}
