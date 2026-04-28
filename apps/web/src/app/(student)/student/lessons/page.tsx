"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { LessonSession } from "@studiq/types";
import { ArrowRight } from "lucide-react";
import { useT } from "@/i18n";

const statusBadge: Record<string, "default" | "success" | "neutral"> = {
  active: "default",
  completed: "success",
  archived: "neutral",
};

export default function LessonsPage() {
  const t = useT();
  const { data: lessons = [], isLoading } = useQuery<LessonSession[]>({
    queryKey: ["lessons"],
    queryFn: () => api.get("/lessons"),
  });

  if (isLoading) return <div className="text-gray-400">{t("common.loading")}</div>;

  return (
    <div>
      {lessons.length === 0 ? (
        <p className="text-gray-500">{t("lessons.noLessons")}</p>
      ) : (
        <div className="space-y-3">
          {lessons.map((lesson) => (
            <Link key={lesson.id} href={`/student/lessons/${lesson.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={statusBadge[lesson.status] ?? "neutral"}>
                        {t(`status.${lesson.status}`)}
                      </Badge>
                      {lesson.ai_generated && (
                        <Badge variant="neutral">AI</Badge>
                      )}
                    </div>
                    <h3 className="font-medium truncate">{lesson.title}</h3>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-sm text-gray-500 tabular-nums">
                      {formatDate(lesson.generated_at)}
                    </span>
                    <ArrowRight size={16} className="text-gray-300 rtl:rotate-180" />
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
