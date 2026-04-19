"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { LearningMapView } from "@/components/learning-map/learning-map-view";
import type { LearningMap } from "@studiq/types";

export default function StudentLearningMapPage() {
  const { data: map, isLoading, error } = useQuery<LearningMap>({
    queryKey: ["learning-map", "self"],
    queryFn: () => api.get(`/learning-map`),
    retry: false,
  });

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold">מפת הלמידה שלי</h1>
        <p className="text-sm text-gray-500 mt-1">
          המסלול שלך, התקדמות בכל נושא, ומה הלאה
        </p>
      </div>

      {isLoading && (
        <div className="text-gray-400 text-sm py-10 text-center">
          טוען...
        </div>
      )}

      {error && (
        <div className="text-gray-400 text-sm py-10 text-center">
          אין עדיין מסלול פעיל. תתחיל לקבל שיעורים והמפה תופיע כאן.
        </div>
      )}

      {map && <LearningMapView role="student" map={map} />}
    </div>
  );
}
