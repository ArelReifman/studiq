"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatPercent } from "@/lib/utils";
import { api } from "@/lib/api";
import { User, ArrowRight, Trash2 } from "lucide-react";

interface StudentCardProps {
  id: string;
  full_name: string;
  grade_level: string | null;
  avg_completion_rate: string | null;
  weak_topics: string[];
  ai_summary: string | null;
}

export function StudentCard({
  id,
  full_name,
  grade_level,
  avg_completion_rate,
  weak_topics,
  ai_summary,
}: StudentCardProps) {
  const rate = avg_completion_rate ? Number(avg_completion_rate) : null;
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/students/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["students"] });
    },
  });

  return (
    <Card className="hover:shadow-md transition-shadow h-full relative group">
      {/* Delete confirmation overlay */}
      {confirmDelete && (
        <div className="absolute inset-0 bg-white/95 rounded-xl z-10 flex flex-col items-center justify-center gap-3 p-4">
          <p className="text-sm text-gray-700 text-center">
            Delete <strong>{full_name}</strong>?
          </p>
          <p className="text-xs text-gray-400 text-center">
            This will remove all their data permanently.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="px-3 py-1.5 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      )}

      {/* Delete button (top-right, visible on hover) */}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setConfirmDelete(true);
        }}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-50 z-[5]"
        title="Delete student"
      >
        <Trash2 size={14} className="text-gray-300 hover:text-red-500" />
      </button>

      <Link href={`/teacher/students/${id}`}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-brand-100 rounded-full flex items-center justify-center flex-shrink-0">
              <User size={16} className="text-brand-600" />
            </div>
            <div>
              <p className="font-medium text-sm">{full_name}</p>
              {grade_level && (
                <p className="text-xs text-gray-400">{grade_level}</p>
              )}
            </div>
          </div>
          {rate !== null && (
            <Badge
              variant={
                rate >= 0.7 ? "success" : rate >= 0.4 ? "warning" : "danger"
              }
            >
              {formatPercent(rate)}
            </Badge>
          )}
        </div>

        {weak_topics.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {weak_topics.slice(0, 3).map((t) => (
              <Badge key={t} variant="danger" className="text-xs">
                {t}
              </Badge>
            ))}
          </div>
        )}

        {ai_summary && (
          <p className="text-xs text-gray-500 line-clamp-2">{ai_summary}</p>
        )}

        <div className="flex justify-end mt-3">
          <ArrowRight size={14} className="text-gray-300" />
        </div>
      </Link>
    </Card>
  );
}
