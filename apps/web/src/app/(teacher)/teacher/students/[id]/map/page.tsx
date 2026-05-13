"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Check, X, Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { LearningMapView } from "@/components/learning-map/learning-map-view";
import { LearningMapHero } from "@/components/learning-map/learning-map-hero";
import { CreateLessonModal } from "@/components/teacher/create-lesson-modal";
import { useT } from "@/i18n";
import type { LearningMap, LessonSession } from "@studiq/types";

interface Course {
  id: string;
  name: string;
}

interface StudentDetail {
  id: string;
  full_name: string;
  primary_course_id: string | null;
}

export default function TeacherLearningMapPage() {
  const t = useT();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [courseId, setCourseId] = useState<string>("");
  const [lessonModal, setLessonModal] = useState<{
    open: boolean;
    topicId?: string;
  }>({ open: false });

  const { data: student } = useQuery<StudentDetail>({
    queryKey: ["students", id],
    queryFn: () => api.get(`/students/${id}`),
  });

  const { data: allCourses = [] } = useQuery<Course[]>({
    queryKey: ["courses"],
    queryFn: () => api.get(`/courses`),
  });

  // Pull this student's lessons so we can show only the courses they're
  // actually working on. Without this, the dropdown listed every course
  // the teacher has, even ones the student has never touched.
  const { data: lessons = [] } = useQuery<LessonSession[]>({
    queryKey: ["lessons", { student_id: id }],
    queryFn: () => api.get(`/lessons?student_id=${id}`),
  });

  // Build the set of course IDs this student is associated with:
  // - courses they have lessons for, PLUS
  // - their primary_course_id (set at signup/approval or via add-course),
  //   so a freshly-onboarded student sees their map even before the first lesson.
  const studentCourseIds = new Set(
    lessons.map((l) => l.course_id).filter((id): id is string => !!id)
  );
  if (student?.primary_course_id) {
    studentCourseIds.add(student.primary_course_id);
  }
  const courses = allCourses.filter((c) => studentCourseIds.has(c.id));

  // Default to first course if none selected
  const effectiveCourseId = courseId || courses[0]?.id || "";

  const { data: map, isLoading } = useQuery<LearningMap>({
    queryKey: ["learning-map", { student_id: id, course_id: effectiveCourseId }],
    queryFn: () =>
      api.get(
        `/learning-map?student_id=${id}&course_id=${effectiveCourseId}`
      ),
    enabled: !!effectiveCourseId,
  });

  // Manual lock toggle on a course topic. Optimistic update so the card
  // flips state instantly; on error we re-fetch to recover.
  const toggleLock = useMutation({
    mutationFn: ({
      topicId,
      nextLocked,
    }: {
      topicId: string;
      nextLocked: boolean;
    }) =>
      api.patch(
        `/courses/${effectiveCourseId}/topics/${topicId}`,
        { is_locked: nextLocked }
      ),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: ["learning-map"] }),
  });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Link
        href={`/teacher/students/${id}`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft size={14} className="rtl:rotate-180" /> {t("map.backToStudent")}
      </Link>

      {/* Inline exam-date editor for THIS student in THIS course. Sits above
          the hero so when the teacher sets a date the countdown below
          updates instantly. Real-world tutors have students at different
          universities — each one needs their own deadline. */}
      {effectiveCourseId && (
        <StudentExamDateEditor
          studentId={id}
          courseId={effectiveCourseId}
          studentName={student?.full_name ?? null}
        />
      )}

      {/* Same hero the student sees, named after the student so the teacher
          gets context at a glance and the visual language is consistent.
          Pass the full map (course name, exam date, topics) so the teacher
          gets the same exam-aware countdown the student does — that's the
          whole point of consistent triage signals. */}
      <LearningMapHero
        studentName={student?.full_name ?? null}
        courseName={map?.course_name ?? null}
        overallPct={map?.overall.overall_pct ?? 0}
        examDate={map?.exam_date ?? null}
        topics={map?.topics ?? []}
      />

      {courses.length > 1 && (
        <div className="flex justify-end mb-4">
          <select
            value={effectiveCourseId}
            onChange={(e) => setCourseId(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {isLoading && (
        <div className="text-gray-400 text-sm py-10 text-center">
          {t("map.loadingMap")}
        </div>
      )}

      {!isLoading && !effectiveCourseId && (
        <div className="text-gray-400 text-sm py-10 text-center">
          {t("map.teacherNoCourses")}{" "}
          <Link href="/teacher/courses" className="text-brand-600 underline">
            {t("map.createCourse")}
          </Link>
        </div>
      )}

      {map && (
        <div className="flex-1 min-h-0 flex flex-col">
          <LearningMapView
            role="teacher"
            map={map}
            onCreateLesson={(topicId) =>
              setLessonModal({ open: true, topicId })
            }
            onToggleLock={(topicId, nextLocked) =>
              toggleLock.mutate({ topicId, nextLocked })
            }
          />
        </div>
      )}

      {lessonModal.open && (
        <CreateLessonModal
          studentId={id}
          /* Carry the topic + course we opened the modal from so the
             dropdowns are pre-selected and the new lesson is filed on
             the right row of the map. */
          initialTopicId={lessonModal.topicId}
          initialCourseId={effectiveCourseId}
          onClose={() => setLessonModal({ open: false })}
        />
      )}
    </div>
  );
}

/** Inline editor for the per-(student, course) exam date override.
 *  Reads the current effective date (override > course default), shows it
 *  as a pill, and expands to a date input on edit. */
function StudentExamDateEditor({
  studentId,
  courseId,
  studentName,
}: {
  studentId: string;
  courseId: string;
  studentName: string | null;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");

  const { data } = useQuery<{
    override_exam_date: string | null;
    course_exam_date: string | null;
    effective_exam_date: string | null;
  }>({
    queryKey: ["exam-date", { student_id: studentId, course_id: courseId }],
    queryFn: () =>
      api.get(`/students/${studentId}/exam-date?course_id=${courseId}`),
    enabled: !!courseId,
  });

  // Seed the draft when entering edit mode so the picker shows the current
  // effective date instead of an empty input.
  useEffect(() => {
    if (editing) {
      const seed =
        data?.override_exam_date ?? data?.course_exam_date ?? null;
      setDraft(seed ? seed.slice(0, 10) : "");
    }
  }, [editing, data]);

  const save = useMutation({
    mutationFn: (exam_date: string | null) =>
      api.put(`/students/${studentId}/exam-date`, {
        course_id: courseId,
        exam_date,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exam-date"] });
      qc.invalidateQueries({ queryKey: ["learning-map"] });
      setEditing(false);
    },
  });

  const hasOverride = !!data?.override_exam_date;
  const effective = data?.effective_exam_date;
  const formatted = effective
    ? new Date(effective).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  if (editing) {
    return (
      <div className="mb-3 flex items-center gap-2 flex-wrap bg-white border border-brand-200 rounded-lg px-3 py-2">
        <CalendarDays size={14} className="text-brand-600 flex-shrink-0" />
        <span className="text-xs text-gray-600 whitespace-nowrap">
          {studentName
            ? t("studentMap.examFor", { name: studentName })
            : t("studentMap.examLabel")}
        </span>
        <input
          autoFocus
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          onClick={() => save.mutate(draft || null)}
          disabled={save.isPending}
          className="inline-flex items-center gap-1 text-xs text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded px-2.5 py-1.5"
        >
          <Check size={12} /> {t("common.save")}
        </button>
        {hasOverride && (
          <button
            onClick={() => save.mutate(null)}
            disabled={save.isPending}
            className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-red-600 hover:bg-red-50 rounded px-2 py-1.5"
            title={t("studentMap.clearOverrideHint")}
          >
            <X size={12} /> {t("studentMap.clearOverride")}
          </button>
        )}
        <button
          onClick={() => setEditing(false)}
          disabled={save.isPending}
          className="text-xs text-gray-400 hover:text-gray-600 rounded px-2 py-1.5"
        >
          {t("common.cancel")}
        </button>
      </div>
    );
  }

  // View mode — clickable pill that opens the editor. Two flavors: an
  // override is set (blue) vs falling back to the course default (gray).
  return (
    <button
      onClick={() => setEditing(true)}
      className={`mb-3 group inline-flex items-center gap-2 text-xs rounded-lg px-3 py-1.5 transition-colors ${
        formatted
          ? hasOverride
            ? "bg-brand-50 border border-brand-200 text-brand-800 hover:bg-brand-100"
            : "bg-gray-50 border border-gray-200 text-gray-700 hover:bg-gray-100"
          : "bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100"
      }`}
    >
      <CalendarDays size={13} />
      {formatted ? (
        <>
          <span className="font-medium">
            {hasOverride
              ? t("studentMap.studentExamDate")
              : t("studentMap.courseExamDate")}
            :
          </span>
          <span className="tabular-nums">{formatted}</span>
        </>
      ) : (
        <span>{t("studentMap.setExamDate")}</span>
      )}
      <Pencil
        size={11}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
      />
    </button>
  );
}
