"use client";

/**
 * Teacher's read-only view of a single student lesson. Mirrors the
 * student lesson page so the teacher can see exactly what the student
 * sees — material PDF, tasks, reflection, and the teacher's own review
 * decision — without needing to log in as the student.
 *
 * Tasks here are display-only (not interactive): the teacher should
 * never mark items "completed/failed" on the student's behalf.
 */
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  FileText,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Circle,
  ClipboardCheck,
  RotateCw,
  ArrowUp,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LessonReviewModal } from "@/components/teacher/lesson-review-modal";
import { formatDate } from "@/lib/utils";
import { useT } from "@/i18n";
import type { LessonWithItems } from "@studiq/types";

export default function TeacherLessonDetailPage() {
  const t = useT();
  const { id, lessonId } = useParams<{ id: string; lessonId: string }>();
  const [reviewOpen, setReviewOpen] = useState(false);

  const { data: lesson, isLoading } = useQuery<LessonWithItems>({
    queryKey: ["lessons", lessonId],
    queryFn: () => api.get(`/lessons/${lessonId}`),
  });

  if (isLoading)
    return <div className="text-gray-400">{t("common.loading")}</div>;
  if (!lesson)
    return <div className="text-gray-400">{t("lessons.notFound")}</div>;

  const hasMaterial = !!lesson.material_url;
  const allItems = [...lesson.homework_items, ...lesson.todo_items];

  return (
    <div>
      <Link
        href={`/teacher/students/${id}`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft size={14} className="rtl:rotate-180" />{" "}
        {t("studentDetail.backToStudent")}
      </Link>

      <div className="flex items-start justify-between mb-6 gap-3">
        <div className="min-w-0">
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
        <Button
          onClick={() => setReviewOpen(true)}
          variant="secondary"
          className="flex items-center gap-1.5 flex-shrink-0"
        >
          <ClipboardCheck size={15} />
          {t("lessonReview.openButton")}
        </Button>
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

      {/* Student-uploaded solution — read-only on the teacher side. The
          student is the only one who can upload or remove this file. */}
      {lesson.student_solution_url && (
        <Card className="mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
              <FileText size={18} className="text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-400 mb-0.5">
                {t("student.yourSolution")}
              </p>
              <a
                href={lesson.student_solution_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-green-700 hover:underline truncate block"
              >
                {lesson.student_solution_name || t("student.yourSolution")}
              </a>
            </div>
          </div>
        </Card>
      )}

      {/* Tasks — read-only for teacher */}
      {allItems.length > 0 && (
        <div className="mb-6">
          <h2 className="text-base font-semibold mb-3">
            {t("student.tasks")}
          </h2>
          <div className="space-y-2">
            {allItems.map((item) => (
              <ReadOnlyTaskRow
                key={item.id}
                title={item.title}
                description={item.description}
                status={item.status}
              />
            ))}
          </div>
        </div>
      )}

      {/* Student reflection — read-only */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare size={16} className="text-brand-500" />
          <h2 className="text-base font-semibold">
            {t("student.reflection")}
          </h2>
        </div>
        {lesson.student_reflection ? (
          <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
            {lesson.student_reflection}
          </p>
        ) : (
          <p className="text-sm text-gray-400">
            {t("studentDetail.reflectionEmpty")}
          </p>
        )}
      </Card>

      {/* Teacher review verdict — show what was already decided */}
      {lesson.teacher_decision && (
        <Card className="mt-4">
          <div className="flex items-start gap-2">
            {lesson.teacher_decision === "repeat" && (
              <RotateCw
                size={16}
                className="text-orange-500 flex-shrink-0 mt-0.5"
              />
            )}
            {lesson.teacher_decision === "next_level" && (
              <ArrowUp
                size={16}
                className="text-brand-500 flex-shrink-0 mt-0.5"
              />
            )}
            {lesson.teacher_decision === "next_topic" && (
              <CheckCircle2
                size={16}
                className="text-green-500 flex-shrink-0 mt-0.5"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-700">
                {t(
                  `lessonReview.${
                    lesson.teacher_decision === "repeat"
                      ? "repeat"
                      : lesson.teacher_decision === "next_level"
                      ? "nextLevel"
                      : "nextTopic"
                  }`
                )}
              </p>
              {lesson.teacher_review_note && (
                <p className="text-sm text-gray-600 whitespace-pre-wrap break-words mt-1">
                  {lesson.teacher_review_note}
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {reviewOpen && (
        <LessonReviewModal
          lesson={lesson}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </div>
  );
}

function ReadOnlyTaskRow({
  title,
  description,
  status,
}: {
  title: string;
  description: string | null;
  status: string;
}) {
  const isCompleted = status === "completed";
  const isFailed = status === "failed";
  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-lg border ${
        isCompleted
          ? "bg-green-50 border-green-100"
          : isFailed
          ? "bg-red-50 border-red-100"
          : "bg-white border-gray-100"
      }`}
    >
      <div className="mt-0.5 flex-shrink-0">
        {isCompleted && (
          <CheckCircle2 size={20} className="text-green-500" />
        )}
        {isFailed && <XCircle size={20} className="text-red-400" />}
        {!isCompleted && !isFailed && (
          <Circle size={20} className="text-gray-300" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm font-medium ${
            isCompleted
              ? "text-green-700 line-through"
              : isFailed
              ? "text-red-600"
              : "text-gray-800"
          }`}
        >
          {title}
        </p>
        {description && (
          <p className="text-xs text-gray-500 mt-1">{description}</p>
        )}
      </div>
    </div>
  );
}
