"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { StudentCard } from "@/components/teacher/student-card";
import { useT } from "@/i18n";

interface StudentRow {
  id: string;
  full_name: string;
  grade_level: string | null;
  avg_completion_rate: string | null;
  weak_topics: string[];
  ai_summary: string | null;
}

export default function StudentsPage() {
  const t = useT();
  const { data: students = [], isLoading } = useQuery<StudentRow[]>({
    queryKey: ["students"],
    queryFn: () => api.get("/students"),
  });

  if (isLoading) return <div className="text-gray-400">{t("common.loading")}</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">
        {t("teacher.studentsCount", { count: students.length })}
      </h1>

      {students.length === 0 ? (
        <p className="text-gray-500">{t("teacher.noStudentsShort")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {students.map((s) => (
            <StudentCard key={s.id} {...s} />
          ))}
        </div>
      )}
    </div>
  );
}
