"use client";

import { useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

// Namespaced per student (unlike the student-side STORAGE_KEY, which is
// global — a teacher browses many different students' pages, so the
// remembered course choice must not leak between them).
function storageKey(studentId: string): string {
  return `studiq.teacher.selectedCourseId.${studentId}`;
}

function readStoredCourseId(studentId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(storageKey(studentId));
  } catch {
    return null;
  }
}

function writeStoredCourseId(studentId: string, id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(studentId), id);
  } catch {
    // Ignore — persistence is best-effort.
  }
}

export interface TeacherStudentCourse {
  id: string;
  name: string;
}

export interface UseTeacherStudentCourseResult {
  hasMultipleCourses: boolean;
  // undefined when the student has 0 or 1 active courses — nothing to scope
  // to, or nothing to choose between.
  selectedCourseId: string | undefined;
  setSelectedCourseId: (id: string) => void;
}

/**
 * Course-selector state for the teacher's student-detail page. Reuses the
 * student's active-courses list already fetched by that page (no separate
 * query) — only owns the URL/localStorage selection logic, mirroring
 * useStudentCourse's pattern but namespaced per student.
 */
export function useTeacherStudentCourse(
  studentId: string | undefined,
  courses: TeacherStudentCourse[]
): UseTeacherStudentCourseResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlCourseId = searchParams.get("course_id");
  const searchParamsStr = searchParams.toString();
  const hasMultipleCourses = courses.length > 1;

  let selectedCourseId: string | undefined;
  if (studentId && courses.length > 0) {
    const ids = new Set(courses.map((c) => c.id));
    const storedCourseId = readStoredCourseId(studentId);
    if (urlCourseId && ids.has(urlCourseId)) {
      selectedCourseId = urlCourseId;
    } else if (storedCourseId && ids.has(storedCourseId)) {
      selectedCourseId = storedCourseId;
    } else {
      selectedCourseId = courses[0]?.id;
    }
  }

  // URL correction effect — same loop-safe pattern as useStudentCourse.
  useEffect(() => {
    if (!studentId || courses.length === 0) return;

    const ids = new Set(courses.map((c) => c.id));
    const storedCourseId = readStoredCourseId(studentId);
    let desired: string | null;
    if (urlCourseId && ids.has(urlCourseId)) {
      desired = urlCourseId;
    } else if (storedCourseId && ids.has(storedCourseId)) {
      desired = storedCourseId;
    } else {
      desired = courses[0]?.id ?? null;
    }
    if (desired) writeStoredCourseId(studentId, desired);

    if (desired === urlCourseId) return;

    const params = new URLSearchParams(searchParamsStr);
    if (desired) {
      params.set("course_id", desired);
    } else {
      params.delete("course_id");
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [studentId, courses, urlCourseId, pathname, searchParamsStr, router]);

  function setSelectedCourseId(id: string) {
    if (!studentId) return;
    writeStoredCourseId(studentId, id);
    const params = new URLSearchParams(searchParamsStr);
    params.set("course_id", id);
    router.replace(`${pathname}?${params.toString()}`);
  }

  return { hasMultipleCourses, selectedCourseId, setSelectedCourseId };
}
