"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { LearningMapView } from "@/components/learning-map/learning-map-view";
import { useT } from "@/i18n";
import type { LearningMap } from "@studiq/types";

export default function StudentLearningMapPage() {
  const t = useT();
  const { data: map, isLoading, error } = useQuery<LearningMap>({
    queryKey: ["learning-map", "self"],
    queryFn: () => api.get(`/learning-map`),
    retry: false,
  });

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold">{t("map.myTitle")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("map.mySubtitle")}</p>
      </div>

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

      {map && <LearningMapView role="student" map={map} />}
    </div>
  );
}
