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
import { ArrowLeft, Sparkles, AlertTriangle } from "lucide-react";

interface StudentDetail {
  id: string;
  full_name: string;
  grade_level: string | null;
  email: string;
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
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

  const generateLesson = useMutation({
    mutationFn: () => api.post("/lessons/generate", { student_id: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lessons"] }),
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
        href="/teacher/students"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft size={14} /> Back to students
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{student?.full_name}</h1>
          {student?.grade_level && (
            <p className="text-gray-500 text-sm">{student.grade_level}</p>
          )}
        </div>
        <Button
          onClick={() => generateLesson.mutate()}
          disabled={generateLesson.isPending}
        >
          <Sparkles size={15} />
          {generateLesson.isPending ? "Generating..." : "Generate New Lesson"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* AI Profile */}
        <div className="lg:col-span-1">
          <Card>
            <h2 className="font-semibold mb-3 text-sm text-gray-600">AI Profile</h2>

            {profile ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-400 mb-1">Completion Rate</p>
                  <p className="font-semibold text-lg">
                    {formatPercent(profile.avg_completion_rate)}
                  </p>
                </div>

                {profile.strong_topics.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Strong Topics</p>
                    <div className="flex flex-wrap gap-1">
                      {profile.strong_topics.map((t) => (
                        <Badge key={t} variant="success">{t}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {profile.weak_topics.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Needs Work</p>
                    <div className="flex flex-wrap gap-1">
                      {profile.weak_topics.map((t) => (
                        <Badge key={t} variant="danger">{t}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {profile.ai_summary && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">AI Summary</p>
                    <p className="text-sm text-gray-700">{profile.ai_summary}</p>
                  </div>
                )}

                <div className="flex gap-4 pt-2 border-t border-gray-50 text-xs text-gray-400">
                  <span>{profile.total_lessons} lessons</span>
                  <span>{profile.total_failures} failures</span>
                </div>
              </div>
            ) : (
              <p className="text-gray-400 text-sm">No AI profile yet.</p>
            )}
          </Card>

          {/* AI Feedback */}
          <Card className="mt-4">
            <h2 className="font-semibold mb-3 text-sm text-gray-600">
              Give AI Feedback
            </h2>
            <select
              value={feedbackType}
              onChange={(e) => setFeedbackType(e.target.value as any)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="general">General</option>
              <option value="lesson_quality">Lesson Quality</option>
              <option value="difficulty_level">Difficulty Level</option>
              <option value="topic_relevance">Topic Relevance</option>
            </select>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="E.g. 'Lessons are too easy', 'Focus more on fractions'"
              rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <Button
              size="sm"
              className="w-full"
              disabled={!feedbackText.trim() || submitFeedback.isPending}
              onClick={() => submitFeedback.mutate()}
            >
              {submitFeedback.isPending ? "Sending..." : "Send Feedback to AI"}
            </Button>
            {submitFeedback.isSuccess && (
              <p className="text-green-600 text-xs mt-2 text-center">
                Feedback will be included in the next generated lesson.
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
                  Recent Difficulties ({difficulties.filter((d) => !d.reviewed).length} unreviewed)
                </h2>
              </div>
              <div className="space-y-2">
                {difficulties.slice(0, 5).map((d) => (
                  <Card key={d.id} className="p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs text-gray-700">{d.description}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {d.topic_tags.map((t) => (
                            <Badge key={t} variant="warning" className="text-xs">{t}</Badge>
                          ))}
                        </div>
                        <p className="text-xs text-gray-300 mt-1">{formatDate(d.created_at)}</p>
                      </div>
                      {!d.reviewed && (
                        <Badge variant="danger" className="flex-shrink-0 ml-2">New</Badge>
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
              Lessons ({lessons.length})
            </h2>
            <div className="space-y-2">
              {lessons.map((l) => (
                <Card key={l.id} className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{l.title}</p>
                      <p className="text-xs text-gray-400">{formatDate(l.generated_at)}</p>
                    </div>
                    <Badge
                      variant={
                        l.status === "completed"
                          ? "success"
                          : l.status === "active"
                          ? "default"
                          : "neutral"
                      }
                    >
                      {l.status}
                    </Badge>
                  </div>
                </Card>
              ))}
              {lessons.length === 0 && (
                <p className="text-gray-400 text-sm">No lessons yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
