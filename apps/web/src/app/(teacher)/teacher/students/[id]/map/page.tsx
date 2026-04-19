"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { LearningMapView } from "@/components/learning-map/learning-map-view";
import { CreateLessonModal } from "@/components/teacher/create-lesson-modal";
import type { LearningMap } from "@studiq/types";

interface Course {
  id: string;
  name: string;
}

interface StudentDetail {
  id: string;
  full_name: string;
}

export default function TeacherLearningMapPage() {
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

  const { data: courses = [] } = useQuery<Course[]>({
    queryKey: ["courses"],
    queryFn: () => api.get(`/courses`),
  });

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

  return (
    <div>
      <Link
        href={`/teacher/students/${id}`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft size={14} className="rtl:rotate-180" /> חזרה לתלמיד
      </Link>

      <div className="flex items-center justify-between mb-5 gap-3">
        <div>
          <h1 className="text-2xl font-bold">מפת למידה</h1>
          {student && (
            <p className="text-sm text-gray-500 mt-1">{student.full_name}</p>
          )}
        </div>
        {courses.length > 1 && (
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
        )}
      </div>

      {isLoading && (
        <div className="text-gray-400 text-sm py-10 text-center">
          טוען מפת למידה...
        </div>
      )}

      {!isLoading && !effectiveCourseId && (
        <div className="text-gray-400 text-sm py-10 text-center">
          אין עדיין מסלולים.{" "}
          <Link href="/teacher/courses" className="text-brand-600 underline">
            צור מסלול
          </Link>
        </div>
      )}

      {map && (
        <LearningMapView
          role="teacher"
          map={map}
          onCreateLesson={(topicId) =>
            setLessonModal({ open: true, topicId })
          }
        />
      )}

      {lessonModal.open && (
        <CreateLessonModal
          studentId={id}
          onClose={() => setLessonModal({ open: false })}
        />
      )}
    </div>
  );
}
