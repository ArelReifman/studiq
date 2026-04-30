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
import { BookOpen, FileText, ExternalLink, History } from "lucide-react";

export default function StudentDashboard() {
  const user = useAuthStore((s) => s.user);
  const t = useT();

  const { data: lessons = [], isLoading } = useQuery<LessonSession[]>({
    queryKey: ["lessons"],
    queryFn: () => api.get("/lessons"),
  });

  const activeLesson = lessons.find((l) => l.status === "active") ?? lessons[0];
  // Everything that isn't the currently-rendered active lesson is "history" —
  // shown lower on the same page (no separate /student/lessons screen).
  const pastLessons = lessons.filter((l) => l.id !== activeLesson?.id);

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
            <div className="flex-1 min-w-0">
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
            <div className="flex flex-col items-end gap-2 flex-shrink-0 ms-3">
              <span className="text-xs text-gray-400">
                {formatDate(activeLesson.generated_at)}
              </span>
              <Link
                href={`/student/lessons/${activeLesson.id}`}
                className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
              >
                {t("student.openLesson")}
                <ExternalLink size={11} />
              </Link>
            </div>
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

      {(homework.length > 0 || todos.length > 0) && (
        <div className="mb-6">
          <h3 className="text-base font-semibold mb-3">
            {t("student.tasks")}
            <span className="text-sm font-normal text-gray-400 ms-2">
              {completedHw + completedTodos}/{totalHw + totalTodos}{" "}
              {t("student.done")}
            </span>
          </h3>
          <div className="space-y-2">
            {/* Legacy homework items (older lessons) */}
            {homework.map((item) => (
              <TaskItem
                key={item.id}
                item={item}
                type="homework"
                lessonId={activeLesson!.id}
              />
            ))}
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

      {/* Lesson history (merged from former /student/lessons page) */}
      {pastLessons.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <History size={16} className="text-gray-400" />
            <h3 className="text-base font-semibold text-gray-700">
              {t("student.history")}
            </h3>
            <span className="text-xs text-gray-400">
              {t("lessons.count", { count: pastLessons.length })}
            </span>
          </div>
          <div className="space-y-2">
            {pastLessons.map((lesson) => (
              <Link key={lesson.id} href={`/student/lessons/${lesson.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant={
                            lesson.status === "completed"
                              ? "success"
                              : lesson.status === "active"
                                ? "default"
                                : "neutral"
                          }
                        >
                          {t(`status.${lesson.status}`)}
                        </Badge>
                        {lesson.ai_generated && (
                          <Badge variant="neutral">AI</Badge>
                        )}
                      </div>
                      <h4 className="text-sm font-medium truncate">
                        {lesson.title}
                      </h4>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0 tabular-nums">
                      {formatDate(lesson.generated_at)}
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
