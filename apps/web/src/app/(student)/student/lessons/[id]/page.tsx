"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TaskItem } from "@/components/student/task-item";
import { formatDate } from "@/lib/utils";
import type { LessonWithItems } from "@studiq/types";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function LessonDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: lesson, isLoading } = useQuery<LessonWithItems>({
    queryKey: ["lessons", id],
    queryFn: () => api.get(`/lessons/${id}`),
  });

  if (isLoading) return <div className="text-gray-400">Loading...</div>;
  if (!lesson) return <div className="text-gray-400">Lesson not found.</div>;

  return (
    <div>
      <Link
        href="/student/lessons"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft size={14} /> Back to lessons
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <Badge variant="default" className="mb-2">
            {lesson.status}
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

      {lesson.homework_items.length > 0 && (
        <div className="mb-6">
          <h2 className="text-base font-semibold mb-3">Homework</h2>
          <div className="space-y-2">
            {lesson.homework_items.map((item) => (
              <TaskItem key={item.id} item={item} type="homework" lessonId={id} />
            ))}
          </div>
        </div>
      )}

      {lesson.todo_items.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-3">Practice Tasks</h2>
          <div className="space-y-2">
            {lesson.todo_items.map((item) => (
              <TaskItem key={item.id} item={item} type="todo" lessonId={id} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
