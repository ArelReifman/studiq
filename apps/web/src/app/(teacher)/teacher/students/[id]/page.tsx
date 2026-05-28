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
import type { LessonSession, DifficultyReport, StudentAiProfile, StudentReport } from "@studiq/types";
import { ArrowLeft, AlertTriangle, Sparkles, Trash2, MessageSquare, Map, ClipboardCheck, RotateCw, ArrowUp, CheckCircle2, ExternalLink, Check, FileBarChart2, BookPlus, Archive } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { useT } from "@/i18n";
import { CreateLessonModal } from "@/components/teacher/create-lesson-modal";
import { LessonFormModal } from "@/components/teacher/LessonFormModal";
import { LessonReviewModal } from "@/components/teacher/lesson-review-modal";
import { StudentContextCard } from "@/components/teacher/student-context-card";
import { StudentBriefingCard } from "@/components/teacher/student-briefing-card";

interface StudentDetail {
  id: string;
  full_name: string;
  grade_level: string | null;
  email: string;
  background_note: string | null;
  next_session_briefing: string | null;
  primary_course_id: string | null;
  // Active courses returned by the API (already filtered server-side to
  // is_active = true). Drives the active-courses card + archive flow.
  courses: { id: string; name: string }[];
}

interface Course {
  id: string;
  name: string;
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const qc = useQueryClient();
  const [showCreateLesson, setShowCreateLesson] = useState(false);
  const [showScheduleLesson, setShowScheduleLesson] = useState(false);
  const [reviewLesson, setReviewLesson] = useState<LessonSession | null>(null);
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [addCourseError, setAddCourseError] = useState<string | null>(null);
  const [addCourseSuccess, setAddCourseSuccess] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState("");

  // Archive course flow state. Two-step:
  //   1. archiveTarget set, archiveFutureCount === null → initial confirmation
  //   2. 409 with futureCount → archiveFutureCount populated → "archive anyway"
  // Cancelling resets all three.
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null);
  const [archiveFutureCount, setArchiveFutureCount] = useState<number | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveSuccess, setArchiveSuccess] = useState(false);

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

  const { data: reports = [] } = useQuery<StudentReport[]>({
    queryKey: ["reports", { student_id: id }],
    queryFn: () => api.get(`/reports?student_id=${id}`),
  });

  const { data: allCourses = [] } = useQuery<Course[]>({
    queryKey: ["courses"],
    queryFn: () => api.get("/courses"),
    enabled: showAddCourse,
  });

  const addCourse = useMutation({
    mutationFn: (course_id: string) =>
      api.post(`/students/${id}/courses`, { course_id }),
    onSuccess: () => {
      setAddCourseSuccess(true);
      setAddCourseError(null);
      qc.invalidateQueries({ queryKey: ["students", id] });
      // The map's course is derived from the student's assignments, so a new
      // course can change what the map shows — refresh it too.
      qc.invalidateQueries({ queryKey: ["learning-map"] });
      setTimeout(() => {
        setShowAddCourse(false);
        setAddCourseSuccess(false);
        setSelectedCourseId("");
      }, 1500);
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("409") || msg.toLowerCase().includes("already")) {
        setAddCourseError(t("teacher.courseAlreadyAssigned"));
      } else {
        setAddCourseError(msg || t("error.updateProfile"));
      }
    },
  });

  // Archive (soft-disable) a course for this student.
  // Uses raw fetch (not the shared api client) because we need to read the
  // structured 409 body — specifically `futureCount` — which the shared
  // client's error helper folds into a plain Error.message and loses.
  const archiveCourse = useMutation({
    mutationFn: async ({ courseId, force }: { courseId: string; force: boolean }) => {
      const token = useAuthStore.getState().token;
      const apiUrl = process.env["NEXT_PUBLIC_API_URL"] ?? "/api";
      const qs = force ? "?force=true" : "";
      const res = await fetch(
        `${apiUrl}/students/${id}/courses/${courseId}/archive${qs}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: "include",
        }
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        futureCount?: number;
      };
      if (!res.ok) {
        const err = new Error(body.error ?? `HTTP ${res.status}`) as Error & {
          status?: number;
          futureCount?: number;
        };
        err.status = res.status;
        if (typeof body.futureCount === "number") err.futureCount = body.futureCount;
        throw err;
      }
      return body;
    },
    onSuccess: () => {
      // Refetch the student so the archived course drops out of the active
      // list everywhere on the page — including LessonFormModal's picker
      // (which keys off the same query).
      qc.invalidateQueries({ queryKey: ["students", id] });
      // Archiving a course can change the map's derived course — refresh it.
      qc.invalidateQueries({ queryKey: ["learning-map"] });
      setArchiveSuccess(true);
      setArchiveFutureCount(null);
      setArchiveError(null);
      // Close after a short success indicator (mirrors addCourse UX).
      setTimeout(() => {
        setArchiveTarget(null);
        setArchiveSuccess(false);
      }, 1500);
    },
    onError: (err) => {
      const e = err as Error & { status?: number; futureCount?: number };
      // 409 + futureCount → switch the dialog into "archive anyway" state.
      // The teacher must re-confirm before we retry with force=true.
      if (e.status === 409 && typeof e.futureCount === "number") {
        setArchiveFutureCount(e.futureCount);
        setArchiveError(null);
        return;
      }
      setArchiveError(e.message || t("error.updateProfile"));
    },
  });

  const generateReport = useMutation({
    mutationFn: () => api.post("/reports/generate", { student_id: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reports", { student_id: id }] }),
    onError: (err) => alert(err instanceof Error ? err.message : t("error.generateReport")),
  });

  // Mark a difficulty report reviewed. Optimistic — flip the row's
  // `reviewed` flag locally so the card disappears instantly. On error we
  // revert and show the message.
  const markReviewed = useMutation({
    mutationFn: (reportId: string) =>
      api.patch(`/difficulties/${reportId}`, { reviewed: true }),
    onMutate: async (reportId) => {
      const queryKey = ["difficulties", { student_id: id }];
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<(DifficultyReport & { student_name: string })[]>(queryKey);
      qc.setQueryData<(DifficultyReport & { student_name: string })[]>(
        queryKey,
        (old = []) => old.map((d) => (d.id === reportId ? { ...d, reviewed: true } : d))
      );
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      qc.setQueryData(["difficulties", { student_id: id }], ctx?.prev);
      alert(err instanceof Error ? err.message : t("error.markReviewed"));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["difficulties"] });
      // Refresh the dashboard counter too so the "needs attention" strip updates.
      qc.invalidateQueries({ queryKey: ["students"] });
    },
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
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["lessons"] });
      // Deleting a lesson changes the topic's lessons_total / progress /
      // latest_lesson_id — refresh the map so the topic action flips back
      // from "open lesson" to "create lesson" when the last one is gone.
      qc.invalidateQueries({ queryKey: ["learning-map"] });
      // Student card stats (completion rate, weak topics) recompute.
      qc.invalidateQueries({ queryKey: ["students"] });
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
        <div className="flex gap-2 flex-wrap">
          <Link
            href={`/teacher/students/${id}/map`}
            className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg px-3 py-2 text-sm font-medium"
          >
            <Map size={15} />
            {t("studentDetail.learningMap")}
          </Link>
          <button
            type="button"
            onClick={() => { setShowAddCourse(true); setAddCourseError(null); setAddCourseSuccess(false); }}
            className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
          >
            <BookPlus size={15} />
            {t("teacher.addCourse")}
          </button>
          <button
            type="button"
            onClick={() => setShowScheduleLesson(true)}
            className="inline-flex items-center gap-1.5 border border-brand-300 text-brand-700 hover:bg-brand-50 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
          >
            <CheckCircle2 size={15} />
            {t("teacher.scheduleLesson")}
          </button>
          <Button
            onClick={() => setShowCreateLesson(true)}
            className="shadow-brand-ring hover:shadow-brand-glow transition-shadow"
          >
            <Sparkles size={15} className="animate-ai-pulse" />
            {t("createLesson.title")}
          </Button>
        </div>
      </div>

      {/* Pre-session briefing — generated by Claude after each lesson review.
          Sits above the grid so it's the first thing the teacher sees when
          opening a student page. */}
      <StudentBriefingCard
        briefing={student?.next_session_briefing ?? null}
        studentName={student?.full_name}
      />

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

          {/* Student Background + Insights — replaces the old free-form
              "feedback to digital teacher" form. Two structured fields the
              AI uses for personalization. */}
          <div className="mt-4">
            <StudentContextCard
              studentId={id}
              initialBackground={student?.background_note ?? null}
            />
          </div>

          {/* Active courses — soft-archivable per-student enrollment list.
              Archived courses (is_active = false) are excluded server-side and
              not shown here. Re-adding the same course via the "Add course"
              dialog reactivates it. */}
          <div className="mt-4">
            <Card>
              <h2 className="font-semibold mb-3 text-sm text-gray-600">
                {t("teacher.activeCourses")}
              </h2>
              {(student?.courses?.length ?? 0) === 0 ? (
                <p className="text-gray-400 text-sm">{t("teacher.noCourses")}</p>
              ) : (
                <ul className="space-y-1">
                  {student?.courses?.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between gap-2 py-1.5"
                    >
                      <span className="text-sm text-gray-700 truncate min-w-0 flex-1">
                        {c.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setArchiveTarget({ id: c.id, name: c.name });
                          setArchiveFutureCount(null);
                          setArchiveError(null);
                          setArchiveSuccess(false);
                        }}
                        aria-label={t("teacher.archiveCourse")}
                        title={t("teacher.archiveCourse")}
                        className="text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-md p-1.5 transition-colors flex-shrink-0"
                      >
                        <Archive size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>

        {/* Lessons + Difficulties */}
        <div className="lg:col-span-2 space-y-6">
          {/* Recent Difficulties — only the unreviewed ones. Once a
              difficulty is marked reviewed (either explicitly or via a
              "next_level"/"next_topic" lesson decision) it falls out of
              this section to keep the teacher focused on what's pending. */}
          {(() => {
            const openDifficulties = difficulties.filter((d) => !d.reviewed);
            if (openDifficulties.length === 0) return null;
            return (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={15} className="text-red-400" />
                  <h2 className="font-semibold text-sm text-gray-600">
                    {t("studentDetail.recentDifficulties", { count: openDifficulties.length })}
                  </h2>
                </div>
                <div className="space-y-2">
                  {openDifficulties.slice(0, 5).map((d) => (
                    <Card key={d.id} className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-gray-700">{d.description}</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {d.topic_tags.map((tag) => (
                              <Badge key={tag} variant="warning" className="text-xs">{tag}</Badge>
                            ))}
                          </div>
                          <p className="text-xs text-gray-300 mt-1">{formatDate(d.created_at)}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                          <Badge variant="danger">{t("studentDetail.new")}</Badge>
                          <button
                            type="button"
                            onClick={() => markReviewed.mutate(d.id)}
                            disabled={markReviewed.isPending}
                            title={t("studentDetail.markReviewedHint")}
                            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 rounded px-2 py-1 transition-colors"
                          >
                            <Check size={12} />
                            {t("studentDetail.markReviewed")}
                          </button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Lessons */}
          <div>
            <h2 className="font-semibold text-sm text-gray-600 mb-3">
              {t("lessons.count", { count: lessons.length })}
            </h2>
            <div className="space-y-2">
              {lessons.map((l) => (
                <Card key={l.id} className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/teacher/students/${id}/lessons/${l.id}`}
                      className="flex-1 min-w-0 group"
                    >
                      <p className="text-sm font-medium truncate group-hover:text-brand-600 transition-colors">
                        {l.title}
                      </p>
                      <p className="text-xs text-gray-400">{formatDate(l.generated_at)}</p>
                    </Link>
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
                      <Link
                        href={`/teacher/students/${id}/lessons/${l.id}`}
                        className="text-gray-400 hover:text-brand-600 transition-colors p-2"
                        aria-label={t("studentDetail.openLesson")}
                        title={t("studentDetail.openLesson")}
                      >
                        <ExternalLink size={14} />
                      </Link>
                      <button
                        type="button"
                        onClick={() => setReviewLesson(l)}
                        className="text-gray-400 hover:text-brand-600 transition-colors p-2"
                        aria-label={t("lessonReview.openButton")}
                        title={t("lessonReview.openButton")}
                      >
                        <ClipboardCheck size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(t("studentDetail.confirmDeleteLesson"))) {
                            deleteLesson.mutate(l.id);
                          }
                        }}
                        disabled={deleteLesson.isPending}
                        className="text-gray-300 hover:text-red-500 disabled:opacity-40 transition-colors p-2"
                        aria-label={t("studentDetail.deleteLesson")}
                        title={t("studentDetail.deleteLesson")}
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
                  {l.teacher_decision && (
                    <div className="mt-2 pt-2 border-t border-gray-50 flex items-start gap-2">
                      {l.teacher_decision === "repeat" && (
                        <RotateCw size={12} className="text-orange-500 flex-shrink-0 mt-0.5" />
                      )}
                      {l.teacher_decision === "next_level" && (
                        <ArrowUp size={12} className="text-brand-500 flex-shrink-0 mt-0.5" />
                      )}
                      {l.teacher_decision === "next_topic" && (
                        <CheckCircle2 size={12} className="text-green-500 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-700">
                          {t(`lessonReview.${
                            l.teacher_decision === "repeat" ? "repeat" :
                            l.teacher_decision === "next_level" ? "nextLevel" : "nextTopic"
                          }`)}
                        </p>
                        {l.teacher_review_note && (
                          <p className="text-xs text-gray-500 whitespace-pre-wrap break-words mt-0.5">
                            {l.teacher_review_note}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              ))}
              {lessons.length === 0 && (
                <p className="text-gray-400 text-sm">{t("studentDetail.noLessons")}</p>
              )}
            </div>
          </div>

          {/* Progress Reports */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileBarChart2 size={15} className="text-gray-400" />
                <h2 className="font-semibold text-sm text-gray-600">
                  {t("reports.sectionTitle")}
                  {reports.length > 0 && (
                    <span className="text-gray-400 font-normal ms-1">({reports.length})</span>
                  )}
                </h2>
              </div>
              <button
                onClick={() => generateReport.mutate()}
                disabled={generateReport.isPending}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:border-brand-300 hover:text-brand-700 hover:bg-brand-50 disabled:opacity-50 transition-colors"
              >
                <Sparkles size={12} className={generateReport.isPending ? "animate-ai-pulse" : ""} />
                {generateReport.isPending ? t("reports.generating") : t("reports.generate")}
              </button>
            </div>

            {reports.length === 0 ? (
              <p className="text-gray-400 text-sm">{t("reports.noReports")}</p>
            ) : (
              <div className="space-y-3">
                {reports.map((report) => {
                  const recs = report.ai_recommendations as {
                    focus_topics?: string[];
                    suggested_difficulty?: string;
                    notes?: string;
                  } | null;
                  return (
                    <Card key={report.id} className="p-3">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Badge variant="neutral">
                          {formatDate(report.period_start)} — {formatDate(report.period_end)}
                        </Badge>
                        {report.completion_rate !== null && (
                          <Badge variant={Number(report.completion_rate) >= 0.7 ? "success" : "warning"}>
                            {formatPercent(report.completion_rate)} {t("reports.completion")}
                          </Badge>
                        )}
                        {report.difficulty_count !== null && report.difficulty_count > 0 && (
                          <span className="text-xs text-gray-400">
                            {report.difficulty_count} {t("reports.difficulties")}
                          </span>
                        )}
                      </div>
                      {report.summary && (
                        <p className="text-sm text-gray-700 mb-2">{report.summary}</p>
                      )}
                      {recs && (
                        <div className="bg-brand-50 rounded-lg p-2.5 text-xs text-brand-700 space-y-1">
                          {recs.notes && <p>{recs.notes}</p>}
                          {recs.focus_topics && recs.focus_topics.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-1">
                              {recs.focus_topics.map((topic) => (
                                <Badge key={topic} variant="neutral" className="text-[10px]">{topic}</Badge>
                              ))}
                            </div>
                          )}
                          {recs.suggested_difficulty && (
                            <p className="text-brand-500 font-medium">
                              {t("reports.suggestedDifficulty")}: {recs.suggested_difficulty}
                            </p>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {showCreateLesson && (
        <CreateLessonModal
          studentId={id}
          onClose={() => setShowCreateLesson(false)}
        />
      )}

      {reviewLesson && (
        <LessonReviewModal
          lesson={reviewLesson}
          onClose={() => setReviewLesson(null)}
        />
      )}

      {/* Schedule a booking directly for this student */}
      {showScheduleLesson && student && (
        <LessonFormModal
          mode="create"
          initialStudentId={student.id}
          initialStudentName={student.full_name}
          onClose={() => setShowScheduleLesson(false)}
          onSuccess={() => {
            // Nothing extra needed — bookings list isn't on this page
          }}
        />
      )}

      {/* Add / change course modal */}
      {showAddCourse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="font-semibold text-base mb-4">
              {t("teacher.addCourseTitle")}
            </h2>
            {addCourseSuccess ? (
              <div className="flex items-center gap-2 text-emerald-600 text-sm py-4 justify-center">
                <CheckCircle2 size={16} />
                {t("teacher.addCourseSuccess")}
              </div>
            ) : (() => {
              // Hide courses the student is already actively enrolled in. The
              // student.courses list is server-filtered to is_active = true,
              // so previously-archived courses stay in availableCourses and
              // can be re-added (the backend re-activates them in place).
              const activeIds = new Set((student?.courses ?? []).map((c) => c.id));
              const availableCourses = allCourses.filter((c) => !activeIds.has(c.id));
              const noneAvailable = availableCourses.length === 0;
              return (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    {t("teacher.selectCourse")}
                  </label>
                  {noneAvailable ? (
                    <p className="text-xs text-gray-500 px-3 py-2 bg-gray-50 rounded-lg">
                      {t("teacher.allCoursesAssigned")}
                    </p>
                  ) : (
                    <select
                      value={selectedCourseId}
                      onChange={(e) => { setSelectedCourseId(e.target.value); setAddCourseError(null); }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      <option value="">{t("teacher.selectCourse")}</option>
                      {availableCourses.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                {addCourseError && (
                  <p className="text-xs text-red-500">{addCourseError}</p>
                )}
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => { setShowAddCourse(false); setSelectedCourseId(""); setAddCourseError(null); }}
                    className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg border border-gray-200 transition-colors"
                  >
                    {t("common.cancel")}
                  </button>
                  <Button
                    onClick={() => selectedCourseId && addCourse.mutate(selectedCourseId)}
                    disabled={!selectedCourseId || addCourse.isPending || noneAvailable}
                  >
                    {addCourse.isPending ? "..." : t("teacher.addCourse")}
                  </Button>
                </div>
              </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Archive course confirmation dialog.
          Two visual states:
            • Initial — shows the course name + an optional "last active
              course" warning when student.courses.length === 1.
            • Future-lessons warning — entered after the backend returns
              409 + futureCount. The teacher must explicitly confirm; the
              retry sends ?force=true. */}
      {archiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            {archiveSuccess ? (
              <div className="flex items-center gap-2 text-emerald-600 text-sm py-4 justify-center">
                <CheckCircle2 size={16} />
                {t("teacher.archiveCourseSuccess")}
              </div>
            ) : (
              <>
                <h2 className="font-semibold text-base mb-1">
                  {t("teacher.archiveCourseConfirmTitle")}
                </h2>
                <p className="text-sm text-gray-600 mb-3 break-words">
                  {archiveTarget.name}
                </p>

                {/* Last-active-course warning — shown only on the initial
                    confirmation, not after the future-lessons step (the
                    future-lessons message takes priority). */}
                {archiveFutureCount === null &&
                  (student?.courses?.length ?? 0) === 1 && (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                      <AlertTriangle
                        size={14}
                        className="text-amber-600 mt-0.5 flex-shrink-0"
                      />
                      <p className="text-xs text-amber-800">
                        {t("teacher.archiveCourseLastWarning")}
                      </p>
                    </div>
                  )}

                {/* Future-lessons warning — populated from the 409 response. */}
                {archiveFutureCount !== null && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                    <AlertTriangle
                      size={14}
                      className="text-amber-600 mt-0.5 flex-shrink-0"
                    />
                    <p className="text-xs text-amber-800">
                      {t("teacher.archiveCourseWarningBody", {
                        count: archiveFutureCount,
                      })}
                    </p>
                  </div>
                )}

                {archiveError && (
                  <p className="text-xs text-red-500 mb-3">{archiveError}</p>
                )}

                <div className="flex flex-wrap gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setArchiveTarget(null);
                      setArchiveFutureCount(null);
                      setArchiveError(null);
                    }}
                    disabled={archiveCourse.isPending}
                    className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg border border-gray-200 transition-colors disabled:opacity-50"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      archiveCourse.mutate({
                        courseId: archiveTarget.id,
                        force: archiveFutureCount !== null,
                      })
                    }
                    disabled={archiveCourse.isPending}
                    className="px-4 py-2 text-sm rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 transition-colors"
                  >
                    {archiveCourse.isPending
                      ? "..."
                      : archiveFutureCount !== null
                      ? t("teacher.archiveCourseProceed")
                      : t("teacher.archiveCourse")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
