"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, BookOpen } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CreateCourseModal } from "@/components/teacher/create-course-modal";
import { useT } from "@/i18n";
import type { Course } from "@studiq/types";

export default function CoursesPage() {
  const t = useT();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: courses = [], isLoading } = useQuery<Course[]>({
    queryKey: ["courses"],
    queryFn: () => api.get("/courses"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/courses/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courses"] }),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("courses.pageTitle")}</h1>
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={16} className="me-1" />
          {t("courses.new")}
        </Button>
      </div>

      {isLoading ? (
        <div className="text-gray-400">{t("common.loading")}</div>
      ) : courses.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-xl bg-white">
          <BookOpen size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 mb-4">{t("courses.empty")}</p>
          <Button onClick={() => setShowCreate(true)} variant="secondary">
            {t("courses.createFirst")}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.map((c) => (
            <div
              key={c.id}
              className="group bg-white border border-gray-100 rounded-xl p-5 hover:shadow-md transition-shadow relative"
            >
              <Link href={`/teacher/courses/${c.id}`} className="block">
                <h3 className="font-semibold text-gray-900 mb-1">{c.name}</h3>
                {c.description && (
                  <p className="text-sm text-gray-500 line-clamp-2">
                    {c.description}
                  </p>
                )}
              </Link>
              <button
                onClick={() => {
                  if (confirm(t("courses.deleteConfirm", { name: c.name }))) {
                    deleteMutation.mutate(c.id);
                  }
                }}
                className="absolute top-3 end-3 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-opacity"
                aria-label={t("common.delete")}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateCourseModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
