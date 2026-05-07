"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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

  const studentCourseIds = new Set(
    lessons.map((l) => l.course_id).filter((id): id is string => !!id)
  );
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

      {/* Same hero the student sees, named after the student so the teacher
          gets context at a glance and the visual language is consistent. */}
      <LearningMapHero
        studentName={student?.full_name ?? null}
        overallPct={map?.overall.overall_pct ?? 0}
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
