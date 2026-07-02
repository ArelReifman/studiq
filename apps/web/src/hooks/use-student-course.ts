"use client";

import { useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Durable memory for the student's chosen course. The URL is the live param
// for the current page, but sidebar nav links don't carry it — so without a
// fallback the selection is lost on every navigation/refresh. localStorage is
// that fallback: it survives navigation, refresh, and new tabs until the
// student deliberately picks another course. Only consulted for multi-course
// students; the 0/1-course legacy path never reads or writes it.
const STORAGE_KEY = "studiq.student.selectedCourseId";

function readStoredCourseId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode / disabled storage — fall back to URL-only behaviour.
    return null;
  }
}

function writeStoredCourseId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Ignore — persistence is best-effort.
  }
}

export interface StudentCourse {
  id: string;
  name: string;
  exam_date: string | null;
  is_primary: boolean;
}

export interface UseStudentCourseResult {
  courses: StudentCourse[];
  isLoading: boolean;
  isError: boolean;
  hasMultipleCourses: boolean;
  // undefined when 0 or 1 active courses — callers MUST NOT forward this to
  // the API in those cases: doing so activates the strict course_id filter
  // which drops legacy null-course lessons from single-course students.
  // Only safe to send to API when courses.length > 1.
  selectedCourseId: string | undefined;
  // The course shown in the selector UI. May be defined even when
  // selectedCourseId is undefined (e.g. 1-course student). Never forwarded
  // to the API automatically — UI display only.
  displayCourseId: string | undefined;
  // Updates URL param course_id via router.replace, preserving other params.
  setSelectedCourseId: (id: string) => void;
}

export function useStudentCourse(): UseStudentCourseResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Read as a primitive so it can be a stable dependency.
  const urlCourseId = searchParams.get("course_id");
  const searchParamsStr = searchParams.toString();

  const {
    data: courses = [],
    isLoading,
    isError,
  } = useQuery<StudentCourse[]>({
    queryKey: ["student-courses"],
    queryFn: () => api.get("/profile/courses"),
    staleTime: 5 * 60 * 1000,
  });

  const hasMultipleCourses = courses.length > 1;

  // Derive selectedCourseId — only defined for multi-course students.
  // Priority: valid URL param → valid stored id → primary → first. The stored
  // fallback is what keeps the choice from snapping back to primary when the
  // student navigates to a page whose URL has no course_id.
  let selectedCourseId: string | undefined;
  if (hasMultipleCourses) {
    const ids = new Set(courses.map((c) => c.id));
    const storedCourseId = readStoredCourseId();
    if (urlCourseId && ids.has(urlCourseId)) {
      selectedCourseId = urlCourseId;
    } else if (storedCourseId && ids.has(storedCourseId)) {
      selectedCourseId = storedCourseId;
    } else {
      selectedCourseId =
        courses.find((c) => c.is_primary)?.id ?? courses[0]?.id;
    }
  }

  // displayCourseId — always the best candidate for selector display, even
  // for single-course students (selector won't be rendered, but value is set).
  const displayCourseId =
    selectedCourseId ??
    (courses.length > 0
      ? courses.find((c) => c.is_primary)?.id ?? courses[0]?.id
      : undefined);

  // URL correction effect.
  // - Runs only after courses are loaded and non-empty.
  // - Computes the desired URL param and replaces only when it differs.
  // - Loop-safe: after replace, urlCourseId changes → desired === urlCourseId
  //   on the next render → early return.
  // - searchParamsStr in deps ensures other params are never lost across runs.
  useEffect(() => {
    if (isLoading || courses.length === 0) return;

    let desired: string | null = null;

    if (hasMultipleCourses) {
      const ids = new Set(courses.map((c) => c.id));
      const storedCourseId = readStoredCourseId();
      if (urlCourseId && ids.has(urlCourseId)) {
        desired = urlCourseId; // already valid
      } else if (storedCourseId && ids.has(storedCourseId)) {
        desired = storedCourseId; // restore last pick instead of defaulting
      } else {
        desired =
          courses.find((c) => c.is_primary)?.id ?? courses[0]?.id ?? null;
      }
      // Keep storage in sync with whatever we resolved to, so an implicit
      // primary-default landing is remembered for subsequent navigations.
      if (desired) writeStoredCourseId(desired);
    }
    // 0 or 1 course → desired = null (remove any stale course_id from URL)

    if (desired === urlCourseId) return;

    const params = new URLSearchParams(searchParamsStr);
    if (desired) {
      params.set("course_id", desired);
    } else {
      params.delete("course_id");
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [isLoading, hasMultipleCourses, courses, urlCourseId, pathname, searchParamsStr, router]);

  function setSelectedCourseId(id: string) {
    writeStoredCourseId(id);
    // A single-lesson page (/student/lessons/<id>) shows a lesson that belongs
    // to the previously-selected course; switching course there would leave
    // stale content on screen. Send the student to their self-practice
    // (dashboard) for the new course instead — it lands on that course's
    // active lesson. Use push so Back returns to the lesson they were on.
    if (pathname.startsWith("/student/lessons/")) {
      router.push(`/student/dashboard?course_id=${id}`);
      return;
    }
    const params = new URLSearchParams(searchParamsStr);
    params.set("course_id", id);
    router.replace(`${pathname}?${params.toString()}`);
  }

  return {
    courses,
    isLoading,
    isError,
    hasMultipleCourses,
    selectedCourseId,
    displayCourseId,
    setSelectedCourseId,
  };
}
