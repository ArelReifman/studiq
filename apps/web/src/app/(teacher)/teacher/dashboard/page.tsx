"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { StudentCard } from "@/components/teacher/student-card";
import { useT } from "@/i18n";
import { Users } from "lucide-react";

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

  // Difficulties used to live in a side-panel here. They were moved to the
  // per-student page (which already had its own difficulties section), and
  // each card surfaces an unreviewed-count badge so nothing is missed.
  const { data: students = [] } = useQuery<StudentRow[]>({
    queryKey: ["students"],
    queryFn: () => api.get("/students"),
  });

  const studentCountText =
    students.length === 1
      ? t("teacher.studentCount", { count: students.length })
      : t("teacher.studentCountPlural", { count: students.length });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t("teacher.dashboard")}</h1>
        <p className="text-gray-500 text-sm mt-0.5">{studentCountText}</p>
      </div>

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
