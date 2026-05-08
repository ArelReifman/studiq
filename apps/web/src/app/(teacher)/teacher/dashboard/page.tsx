"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { StudentCard } from "@/components/teacher/student-card";
import { useT } from "@/i18n";
import { Users, AlertTriangle } from "lucide-react";

interface StudentRow {
  id: string;
  full_name: string;
  grade_level: string | null;
  avg_completion_rate: string | null;
  weak_topics: string[];
  ai_summary: string | null;
  unreviewed_difficulties: number;
}

export default function TeacherDashboard() {
  const t = useT();

  const { data: students = [] } = useQuery<StudentRow[]>({
    queryKey: ["students"],
    queryFn: () => api.get("/students"),
  });

  const studentCountText =
    students.length === 1
      ? t("teacher.studentCount", { count: students.length })
      : t("teacher.studentCountPlural", { count: students.length });

  const needsAttention = students.filter((s) => s.unreviewed_difficulties > 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t("teacher.dashboard")}</h1>
        <p className="text-gray-500 text-sm mt-0.5">{studentCountText}</p>
      </div>

      {needsAttention.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={15} className="text-amber-500" />
            <h2 className="font-semibold text-sm text-amber-700">
              {t("teacher.needsAttention")}
            </h2>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {needsAttention.map((s) => (
              <Link
                key={s.id}
                href={`/teacher/students/${s.id}`}
                className="flex-shrink-0 flex items-center gap-3 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors rounded-xl px-4 py-3 min-w-[200px]"
              >
                <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={14} className="text-amber-600" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{s.full_name}</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    {t("teacher.unreviewedDifficulties", {
                      count: s.unreviewed_difficulties,
                    })}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <Users size={16} className="text-gray-400" />
        <h2 className="font-semibold text-sm text-gray-600">
          {t("teacher.yourStudents")}
        </h2>
      </div>

      {students.length === 0 ? (
        <Card>
          <p className="text-gray-400 text-sm text-center py-4">
            {t("teacher.noStudents")}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {students.map((s) => (
            <StudentCard key={s.id} {...s} />
          ))}
        </div>
      )}
    </div>
  );
}
