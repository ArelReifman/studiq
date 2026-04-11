"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { TeacherAiFeedback } from "@studiq/types";
import { useT } from "@/i18n";

const sentimentVariant = {
  positive: "success",
  negative: "danger",
  neutral: "neutral",
} as const;

export default function FeedbackPage() {
  const t = useT();
  const { data: feedback = [], isLoading } = useQuery<TeacherAiFeedback[]>({
    queryKey: ["ai-feedback"],
    queryFn: () => api.get("/ai-feedback"),
  });

  if (isLoading) return <div className="text-gray-400">{t("common.loading")}</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">{t("feedback.title")}</h1>
      <p className="text-gray-500 text-sm mb-6">
        {t("feedback.subtitle")}
      </p>

      {feedback.length === 0 ? (
        <Card>
          <p className="text-gray-400 text-sm text-center py-4">
            {t("feedback.empty")}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {feedback.map((f) => (
            <Card key={f.id}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Badge variant="neutral">{t(`feedbackType.${f.feedback_type}`)}</Badge>
                  {f.sentiment && (
                    <Badge variant={sentimentVariant[f.sentiment] ?? "neutral"}>
                      {t(`sentiment.${f.sentiment}`)}
                    </Badge>
                  )}
                  <Badge variant={f.incorporated ? "success" : "warning"}>
                    {f.incorporated ? t("feedback.incorporated") : t("feedback.pending")}
                  </Badge>
                </div>
                <span className="text-xs text-gray-400">{formatDate(f.created_at)}</span>
              </div>
              <p className="text-sm text-gray-700">{f.content}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
