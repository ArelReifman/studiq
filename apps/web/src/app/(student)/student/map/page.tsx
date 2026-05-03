"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { LearningMapView } from "@/components/learning-map/learning-map-view";
import { LearningMapHero } from "@/components/learning-map/learning-map-hero";
import { useT } from "@/i18n";
import { useAuthStore } from "@/store/auth";
import type { LearningMap } from "@studiq/types";

export default function StudentLearningMapPage() {
  const t = useT();
  const { user } = useAuthStore();
  const { data: map, isLoading, error } = useQuery<LearningMap>({
    queryKey: ["learning-map", "self"],
    queryFn: () => api.get(`/learning-map`),
    retry: false,
  });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <LearningMapHero
        studentName={user?.full_name ?? null}
        overallPct={map?.overall.overall_pct ?? 0}
      />

      {isLoading && (
        <div className="text-gray-400 text-sm py-10 text-center">
          {t("map.loading")}
        </div>
      )}

      {error && (
        <div className="text-gray-400 text-sm py-10 text-center">
          {t("map.studentEmpty")}
        </div>
      )}

      {map && (
        <div className="flex-1 min-h-0 flex flex-col">
          <LearningMapView role="student" map={map} />
        </div>
      )}
    </div>
  );
}
