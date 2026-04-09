"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { TeacherAiFeedback } from "@studiq/types";

const sentimentVariant = {
  positive: "success",
  negative: "danger",
  neutral: "neutral",
} as const;

export default function FeedbackPage() {
  const { data: feedback = [], isLoading } = useQuery<TeacherAiFeedback[]>({
    queryKey: ["ai-feedback"],
    queryFn: () => api.get("/ai-feedback"),
  });

  if (isLoading) return <div className="text-gray-400">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">AI Feedback History</h1>
      <p className="text-gray-500 text-sm mb-6">
        Feedback you have given to the AI tutor. Incorporated feedback shapes the next generated lesson.
      </p>

      {feedback.length === 0 ? (
        <Card>
          <p className="text-gray-400 text-sm text-center py-4">
            No feedback submitted yet. Go to a student page to send feedback to the AI.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {feedback.map((f) => (
            <Card key={f.id}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Badge variant="neutral">{f.feedback_type.replace("_", " ")}</Badge>
                  {f.sentiment && (
                    <Badge variant={sentimentVariant[f.sentiment] ?? "neutral"}>
                      {f.sentiment}
                    </Badge>
                  )}
                  <Badge variant={f.incorporated ? "success" : "warning"}>
                    {f.incorporated ? "Incorporated" : "Pending"}
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
