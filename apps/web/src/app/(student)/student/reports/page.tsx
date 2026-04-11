"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatPercent } from "@/lib/utils";
import type { StudentReport } from "@studiq/types";
import { useT } from "@/i18n";

export default function StudentReportsPage() {
  const t = useT();
  const { data: reports = [], isLoading } = useQuery<StudentReport[]>({
    queryKey: ["reports"],
    queryFn: () => api.get("/reports"),
  });

  if (isLoading) return <div className="text-gray-400">{t("common.loading")}</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t("reports.myProgress")}</h1>

      {reports.length === 0 ? (
        <Card>
          <p className="text-gray-500 text-sm">
            {t("reports.empty")}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {reports.map((report) => (
            <Card key={report.id}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Badge variant="neutral">
                    {formatDate(report.period_start)} — {formatDate(report.period_end)}
                  </Badge>
                  {report.completion_rate && (
                    <Badge
                      variant={
                        Number(report.completion_rate) >= 0.7 ? "success" : "warning"
                      }
                    >
                      {formatPercent(report.completion_rate)} {t("reports.completion")}
                    </Badge>
                  )}
                </div>
                {report.difficulty_count !== null && (
                  <span className="text-xs text-gray-400">
                    {report.difficulty_count} {t("reports.difficulties")}
                  </span>
                )}
              </div>

              {report.summary && (
                <p className="text-sm text-gray-700 mb-3">{report.summary}</p>
              )}

              {report.ai_recommendations && (
                <div className="bg-brand-50 rounded-lg p-3 text-sm text-brand-700">
                  <span className="font-medium">{t("reports.aiRecommendation")}</span>
                  {(report.ai_recommendations as any).notes}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
