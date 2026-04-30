"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatPercent } from "@/lib/utils";
import type { LessonSession, DifficultyReport, StudentAiProfile } from "@studiq/types";
import { ArrowLeft, AlertTriangle, Sparkles, Trash2, MessageSquare, Map } from "lucide-react";
import { useT } from "@/i18n";
import { CreateLessonModal } from "@/components/teacher/create-lesson-modal";

interface StudentDetail {
  id: string;
  full_name: string;
  grade_level: string | null;
  email: string;
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const qc = useQueryClient();
  const [showCreateLesson, setShowCreateLesson] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackType, setFeedbackType] = useState<
    "lesson_quality" | "difficulty_level" | "topic_relevance" | "general"
  >("general");

  const { data: student } = useQuery<StudentDetail>({
    queryKey: ["students", id],
    queryFn: () => api.get(`/students/${id}`),
  });

  const { data: profile } = useQuery<StudentAiProfile>({
    queryKey: ["students", id, "profile"],
    queryFn: () => api.get(`/students/${id}/profile`),
  });

  const { data: lessons = [] } = useQuery<LessonSession[]>({
    queryKey: ["lessons", { student_id: id }],
    queryFn: () => api.get(`/lessons?student_id=${id}`),
  });

  const { data: difficulties = [] } = useQuery<(DifficultyReport & { student_name: string })[]>({
    queryKey: ["difficulties", { student_id: id }],
    queryFn: () => api.get(`/difficulties?student_id=${id}`),
  });

  const deleteLesson = useMutation({
    mutationFn: (lessonId: string) => api.delete(`/lessons/${lessonId}`),
    onMutate: async (lessonId) => {
      const queryKey = ["lessons", { student_id: id }];
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<LessonSession[]>(queryKey);
      qc.setQueryData<LessonSession[]>(queryKey, (old = []) =>
        old.filter((l) => l.id !== lessonId)
      );
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      qc.setQueryData(["lessons", { student_id: id }], ctx?.prev);
      alert(err instanceof Error ? err.message : t("studentDetail.deleteFailed"));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["lessons"] }),
  });

  const submitFeedback = useMutation({
    mutationFn: () =>
      api.post("/ai-feedback", {
        student_id: id,
        feedback_type: feedbackType,
        content: feedbackText,
        sentiment: "general",
      }),
    onSuccess: () => {
      setFeedbackText("");
    },
  });

  return (
    <div>
      <Link
        href="/teacher/dashboard"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft size={14} className="rtl:rotate-180" /> {t("studentDetail.backToStudents")}
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{student?.full_name}</h1>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/teacher/students/${id}/map`}
            className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg px-3 py-2 text-sm font-medium"
          >
            <Map size={15} />
            {t("studentDetail.learningMap")}
          </Link>
          <Button
            onClick={() => setShowCreateLesson(true)}
            className="shadow-brand-ring hover:shadow-brand-glow transition-shadow"
          >
            <Sparkles size={15} className="animate-ai-pulse" />
            {t("createLesson.title")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* AI Profile */}
        <div className="lg:col-span-1">
          <Card>
            <h2 className="font-semibold mb-3 text-sm text-gray-600">{t("studentDetail.aiProfile")}</h2>

            {profile ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-400 mb-1">{t("studentDetail.completionRate")}</p>
                  <p className="font-semibold text-lg">
                    {formatPercent(profile.avg_completion_rate)}
                  </p>
                </div>

                {profile.strong_topics.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">{t("studentDetail.strongTopics")}</p>
                    <div className="flex flex-wrap gap-1">
                      {profile.strong_topics.map((topic) => (
                        <Badge key={topic} variant="success">{topic}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {profile.weak_topics.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">{t("studentDetail.needsWork")}</p>
                    <div className="flex flex-wrap gap-1">
                      {profile.weak_topics.map((topic) => (
                        <Badge key={topic} variant="danger">{topic}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {profile.ai_summary && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">{t("studentDetail.aiSummary")}</p>
                    <p className="text-sm text-gray-700">{profile.ai_summary}</p>
                  </div>
                )}

                <div className="flex gap-4 pt-2 border-t border-gray-50 text-xs text-gray-400">
                  <span>{profile.total_lessons} {t("studentDetail.lessons")}</span>
                  <span>{profile.total_failures} {t("studentDetail.failures")}</span>
                </div>
              </div>
            ) : (
              <p className="text-gray-400 text-sm">{t("studentDetail.noAiProfile")}</p>
            )}
          </Card>

          {/* AI Feedback */}
          <Card className="mt-4">
            <h2 className="font-semibold mb-3 text-sm text-gray-600">
              {t("studentDetail.giveFeedback")}
            </h2>
            <select
              value={feedbackType}
              onChange={(e) => setFeedbackType(e.target.value as any)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="general">{t("studentDetail.general")}</option>
              <option value="lesson_quality">{t("studentDetail.lessonQuality")}</option>
              <option value="difficulty_level">{t("studentDetail.difficultyLevel")}</option>
              <option value="topic_relevance">{t("studentDetail.topicRelevance")}</option>
            </select>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder={t("studentDetail.feedbackPlaceholder")}
              rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <Button
              size="sm"
              className="w-full"
              disabled={!feedbackText.trim() || submitFeedback.isPending}
              onClick={() => submitFeedback.mutate()}
            >
              {submitFeedback.isPending ? t("studentDetail.sending") : t("studentDetail.sendFeedback")}
            </Button>
            {submitFeedback.isSuccess && (
              <p className="text-green-600 text-xs mt-2 text-center">
                {t("studentDetail.feedbackNote")}
              </p>
            )}
          </Card>
        </div>

        {/* Lessons + Difficulties */}
        <div className="lg:col-span-2 space-y-6">
          {/* Recent Difficulties */}
          {difficulties.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={15} className="text-red-400" />
                <h2 className="font-semibold text-sm text-gray-600">
                  {t("studentDetail.recentDifficulties", { count: difficulties.filter((d) => !d.reviewed).length })}
                </h2>
              </div>
              <div className="space-y-2">
                {difficulties.slice(0, 5).map((d) => (
                  <Card key={d.id} className="p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs text-gray-700">{d.description}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {d.topic_tags.map((tag) => (
                            <Badge key={tag} variant="warning" className="text-xs">{tag}</Badge>
                          ))}
                        </div>
                        <p className="text-xs text-gray-300 mt-1">{formatDate(d.created_at)}</p>
                      </div>
                      {!d.reviewed && (
                        <Badge variant="danger" className="flex-shrink-0 ms-2">{t("studentDetail.new")}</Badge>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Lessons */}
          <div>
            <h2 className="font-semibold text-sm text-gray-600 mb-3">
              {t("lessons.count", { count: lessons.length })}
            </h2>
            <div className="space-y-2">
              {lessons.map((l) => (
                <Card key={l.id} className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{l.title}</p>
                      <p className="text-xs text-gray-400">{formatDate(l.generated_at)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge
                        variant={
                          l.status === "completed"
                            ? "success"
                            : l.status === "active"
                            ? "default"
                            : "neutral"
                        }
                      >
                        {t(`status.${l.status}`)}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(t("studentDetail.confirmDeleteLesson"))) {
                            deleteLesson.mutate(l.id);
                          }
                        }}
                        disabled={deleteLesson.isPending}
                        className="text-gray-300 hover:text-red-500 disabled:opacity-40 transition-colors p-1"
                        aria-label={t("studentDetail.deleteLesson")}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {l.student_reflection && (
                    <div className="mt-2 pt-2 border-t border-gray-50 flex items-start gap-2">
                      <MessageSquare size={12} className="text-brand-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-gray-600 whitespace-pre-wrap break-words">
                        {l.student_reflection}
                      </p>
                    </div>
                  )}
                </Card>
              ))}
              {lessons.length === 0 && (
                <p className="text-gray-400 text-sm">{t("studentDetail.noLessons")}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {showCreateLesson && (
        <CreateLessonModal
          studentId={id}
          onClose={() => setShowCreateLesson(false)}
        />
      )}
    </div>
  );
}
