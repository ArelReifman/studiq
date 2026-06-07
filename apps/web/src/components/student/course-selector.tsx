"use client";

import { useStudentCourse } from "@/hooks/use-student-course";
import { useT } from "@/i18n";

/**
 * Renders a course picker when the student is enrolled in more than one
 * active course. Returns null for 0/1 courses and while loading.
 *
 * Presentational: all state lives in useStudentCourse (URL + React Query).
 * No props needed — the hook owns URL reading and writing.
 */
export function CourseSelector() {
  const { courses, isLoading, isError, hasMultipleCourses, displayCourseId, setSelectedCourseId } =
    useStudentCourse();
  const t = useT();

  // Show nothing while loading, on error, or when there is only one course.
  if (isLoading || isError || !hasMultipleCourses) return null;

  return (
    <div className="px-3 pb-2">
      <label
        htmlFor="student-course-selector"
        className="block text-xs text-gray-400 mb-1 select-none"
      >
        {t("student.courseLabel")}
      </label>
      <select
        id="student-course-selector"
        value={displayCourseId ?? ""}
        onChange={(e) => setSelectedCourseId(e.target.value)}
        className="w-full text-sm rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
      >
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
