"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatPercent } from "@/lib/utils";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import { User, ArrowRight, Trash2, AlertTriangle } from "lucide-react";

interface StudentCardProps {
  id: string;
  full_name: string;
  grade_level: string | null;
  avg_completion_rate: string | null;
  weak_topics: string[];
  ai_summary: string | null;
  unreviewed_difficulties?: number;
}

export function StudentCard({
  id,
  full_name,
  avg_completion_rate,
  weak_topics,
  ai_summary,
  unreviewed_difficulties = 0,
}: StudentCardProps) {
  const rate = avg_completion_rate ? Number(avg_completion_rate) : null;
  const qc = useQueryClient();
  const t = useT();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/students/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["students"] });
    },
  });

  return (
    <Card className="hover:shadow-md transition-shadow h-full relative group">
      {confirmDelete && (
        <div className="absolute inset-0 bg-white/95 rounded-xl z-10 flex flex-col items-center justify-center gap-3 p-4">
          <p className="text-sm text-gray-700 text-center">
            {t("teacher.deleteStudent", { name: full_name })}
          </p>
          <p className="text-xs text-gray-400 text-center">
            {t("teacher.deleteWarning")}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="px-3 py-1.5 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
            >
              {deleteMutation.isPending
                ? t("common.deleting")
                : t("common.delete")}
            </button>
          </div>
        </div>
      )}

      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setConfirmDelete(true);
        }}
        className="absolute top-3 end-3 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-50 z-[5]"
        title={t("common.delete")}
      >
        <Trash2 size={14} className="text-gray-300 hover:text-red-500" />
      </button>

      <Link
        href={`/teacher/students/${id}`}
        prefetch
        onMouseEnter={() => {
          // Warm the cache for the destination page so the click feels
          // instant. Cheap (one HTTP cache hit), idempotent — React
          // Query dedupes if the data is already fresh.
          qc.prefetchQuery({
            queryKey: ["students", id],
            queryFn: () => api.get(`/students/${id}`),
          });
          qc.prefetchQuery({
            queryKey: ["students", id, "profile"],
            queryFn: () => api.get(`/students/${id}/profile`),
          });
          qc.prefetchQuery({
            queryKey: ["lessons", { student_id: id }],
            queryFn: () => api.get(`/lessons?student_id=${id}`),
          });
        }}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 bg-brand-100 rounded-full flex items-center justify-center flex-shrink-0">
              <User size={16} className="text-brand-600" />
            </div>
            <div className="min-w-0">
              <p className="font-medium text-sm truncate">{full_name}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {unreviewed_difficulties > 0 && (
              <span title={t("teacher.difficulties")}>
                <Badge
                  variant="danger"
                  className="inline-flex items-center gap-1"
                >
                  <AlertTriangle size={11} />
                  {unreviewed_difficulties}
                </Badge>
              </span>
            )}
            {rate !== null && (
              <Badge
                variant={
                  rate === 0
                    ? "default"
                    : rate >= 0.7
                    ? "success"
                    : rate >= 0.4
                    ? "warning"
                    : "danger"
                }
              >
                {formatPercent(rate)}
              </Badge>
            )}
          </div>
        </div>

        {weak_topics.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {weak_topics.slice(0, 3).map((topic) => (
              <Badge key={topic} variant="danger" className="text-xs">
                {topic}
              </Badge>
            ))}
          </div>
        )}

        {ai_summary && (
          <p className="text-xs text-gray-500 line-clamp-2">{ai_summary}</p>
        )}

        <div className="flex justify-end mt-3">
          <ArrowRight
            size={14}
            className="text-gray-300 rtl:rotate-180"
          />
        </div>
      </Link>
    </Card>
  );
}
