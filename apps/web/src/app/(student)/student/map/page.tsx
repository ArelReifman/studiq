"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { LearningMapView } from "@/components/learning-map/learning-map-view";
import { LearningMapSkeleton } from "@/components/learning-map/learning-map-skeleton";
import { LearningMapHero } from "@/components/learning-map/learning-map-hero";
import { useT } from "@/i18n";
import { useAuthStore } from "@/store/auth";
import { useStudentCourse } from "@/hooks/use-student-course";
import type { LearningMap, LessonSession } from "@studiq/types";

export default function StudentLearningMapPage() {
  const t = useT();
  const router = useRouter();
  const { user } = useAuthStore();

  // selectedCourseId is undefined for 0/1-course students (legacy path).
  // Queries are gated on !isCourseLoading so multi-course students never
  // fire an unscoped request before the course list is resolved.
  const { selectedCourseId, isLoading: isCourseLoading } = useStudentCourse();

  const { data: map, isLoading: isMapLoading, error } = useQuery<LearningMap>({
    queryKey: ["learning-map", "self", selectedCourseId ?? "all"],
    queryFn: () =>
      api.get(
        selectedCourseId
          ? `/learning-map?course_id=${selectedCourseId}`
          : `/learning-map`
      ),
    retry: false,
    enabled: !isCourseLoading,
  });

  const isLoading = isCourseLoading || isMapLoading;

  // Pulled lazily so we can resolve "Continue learning" → the right lesson
  // without paying a network cost on first paint of the map.
  const { data: lessons = [] } = useQuery<LessonSession[]>({
    queryKey: ["lessons", selectedCourseId ?? "all"],
    queryFn: () =>
      api.get(
        selectedCourseId
          ? `/lessons?course_id=${selectedCourseId}`
          : `/lessons`
      ),
    enabled: !isCourseLoading,
  });

  // When the student clicks "Continue learning" on a topic card we send
  // them to the most recent active lesson for that topic. If we can't
  // find one (rare — teacher hasn't created a lesson yet) we fall back
  // to the dashboard, which surfaces whatever they have.
  const handleContinue = (topicId: string) => {
    const inTopic = lessons.filter((l) => l.topic_id === topicId);
    const active = inTopic.find((l) => l.status === "active") ?? inTopic[0];
    if (active) {
      router.push(`/student/lessons/${active.id}`);
    } else {
      router.push("/student/dashboard");
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <LearningMapHero
        studentName={user?.full_name ?? null}
        courseName={map?.course_name ?? null}
        overallPct={map?.overall.overall_pct ?? 0}
        examDate={map?.exam_date ?? null}
        topics={map?.topics ?? []}
      />

      {isLoading && (
        <div className="flex-1 min-h-0 flex flex-col">
          <LearningMapSkeleton />
        </div>
      )}

      {error && (
        <div className="text-gray-400 text-sm py-10 text-center">
          {t("map.studentEmpty")}
        </div>
      )}

      {map && (
        <div className="flex-1 min-h-0 flex flex-col">
          <LearningMapView
            role="student"
            map={map}
            onCreateLesson={handleContinue}
            onOpenLesson={(lessonId) =>
              router.push(`/student/lessons/${lessonId}`)
            }
          />
        </div>
      )}
    </div>
  );
}
