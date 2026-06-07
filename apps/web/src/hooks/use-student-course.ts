"use client";

import { useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

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
  let selectedCourseId: string | undefined;
  if (hasMultipleCourses) {
    const ids = new Set(courses.map((c) => c.id));
    if (urlCourseId && ids.has(urlCourseId)) {
      selectedCourseId = urlCourseId;
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
      if (urlCourseId && ids.has(urlCourseId)) {
        desired = urlCourseId; // already valid
      } else {
        desired =
          courses.find((c) => c.is_primary)?.id ?? courses[0]?.id ?? null;
      }
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
