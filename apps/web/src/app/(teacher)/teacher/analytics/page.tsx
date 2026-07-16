"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useT, useLocaleStore } from "@/i18n";
import { Card } from "@/components/ui/card";
import { BarChart2, Search, ChevronDown, ChevronUp } from "lucide-react";

interface StudentActivityRow {
  student_id: string;
  full_name: string;
  courses: string[];
  login_count: number;
  login_dates: { date: string; count: number }[];
  last_login_at: string | null;
  supabase_last_sign_in_at: string | null;
  lesson_opened_count: number;
  last_lesson_opened_at: string | null;
  learning_map_opened_count: number;
  last_learning_map_opened_at: string | null;
  reflection_saved_count: number;
  last_reflection_saved_at: string | null;
  solution_uploaded_count: number;
  last_solution_uploaded_at: string | null;
}

type LessonEventType =
  | "lesson.opened"
  | "lesson.reflection_saved"
  | "lesson.solution_uploaded";

interface LessonEventRow {
  event_type: LessonEventType;
  lesson_id: string | null;
  lesson_title: string | null;
  occurred_at: string;
}

function formatDateTime(iso: string | null, locale: "he" | "en"): string {
  if (!iso) return "—";
  const d = new Date(iso.replace(" ", "T"));
  return (
    d.toLocaleDateString(locale) +
    " " +
    d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
  );
}

export default function AnalyticsPage() {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("");

  const { data: rows = [], isLoading } = useQuery<StudentActivityRow[]>({
    queryKey: ["admin-analytics-overview"],
    queryFn: () => api.get("/admin-analytics/overview"),
  });

  const courseOptions = useMemo(
    () => Array.from(new Set(rows.flatMap((r) => r.courses))).sort(),
    [rows]
  );

  const sorted = [...rows]
    .filter((r) =>
      search.trim()
        ? r.full_name.toLowerCase().includes(search.trim().toLowerCase())
        : true
    )
    .filter((r) => (courseFilter ? r.courses.includes(courseFilter) : true))
    .sort((a, b) => {
      const aLast = a.supabase_last_sign_in_at ?? "";
      const bLast = b.supabase_last_sign_in_at ?? "";
      return bLast.localeCompare(aLast);
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">
          {t("analytics.title")}
        </h1>
        <p className="text-sm text-gray-400 mt-1">{t("analytics.subtitle")}</p>
      </div>

      {rows.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search
              size={15}
              className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-300"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("analytics.searchByName")}
              className="w-full border border-gray-200 rounded-lg ps-9 pe-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          {courseOptions.length > 0 && (
            <select
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
            >
              <option value="">{t("analytics.allCourses")}</option>
              {courseOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-xl bg-white">
          <div className="w-12 h-12 rounded-full bg-brand-50 mx-auto mb-3 flex items-center justify-center">
            <BarChart2 size={20} className="text-brand-500" />
          </div>
          <p className="text-sm text-gray-500">{t("analytics.noStudents")}</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-xl bg-white">
          <p className="text-sm text-gray-500">{t("analytics.noResults")}</p>
        </div>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-start">
                  <th className="text-start font-medium text-gray-500 px-4 py-3">
                    {t("analytics.student")}
                  </th>
                  <th className="text-start font-medium text-gray-500 px-4 py-3">
                    {t("analytics.lastSeen")}
                  </th>
                  <th className="text-center font-medium text-gray-500 px-4 py-3">
                    {t("analytics.logins")}
                  </th>
                  <th className="text-center font-medium text-gray-500 px-4 py-3">
                    {t("analytics.lessonsOpened")}
                  </th>
                  <th className="text-center font-medium text-gray-500 px-4 py-3">
                    {t("analytics.mapOpened")}
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <StudentActivityRow key={s.student_id} row={s} locale={locale} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function StudentActivityRow({
  row,
  locale,
}: {
  row: StudentActivityRow;
  locale: "he" | "en";
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const stale =
    !row.supabase_last_sign_in_at ||
    Date.now() - new Date(row.supabase_last_sign_in_at).getTime() >
      30 * 24 * 60 * 60 * 1000;

  const { data: lessonEvents = [], isLoading: lessonEventsLoading } = useQuery<
    LessonEventRow[]
  >({
    queryKey: ["admin-analytics-lesson-events", row.student_id],
    queryFn: () =>
      api.get(`/admin-analytics/students/${row.student_id}/lesson-events`),
    enabled: expanded && row.lesson_opened_count > 0,
  });

  const lessonOpens = lessonEvents.filter(
    (ev) => ev.event_type === "lesson.opened"
  );

  return (
    <>
      <tr className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors">
        <td className="px-4 py-3">
          <p className="font-medium text-gray-900">{row.full_name}</p>
          {row.courses.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">
              {row.courses.join(" · ")}
            </p>
          )}
        </td>
        <td
          className={`px-4 py-3 ${stale ? "text-red-600" : "text-gray-600"}`}
          title={
            row.login_dates.length
              ? `${t("analytics.loginHistory")}: ${row.login_dates
                  .map((d) => `${formatDateTime(d.date, locale)} (${d.count})`)
                  .join(", ")}`
              : undefined
          }
        >
          {row.supabase_last_sign_in_at
            ? formatDateTime(row.supabase_last_sign_in_at, locale)
            : t("analytics.never")}
        </td>
        <td className="px-4 py-3 text-center text-gray-600">
          {row.login_count}
        </td>
        <td className="px-4 py-3 text-center text-gray-600">
          {row.lesson_opened_count}
        </td>
        <td className="px-4 py-3 text-center text-gray-600">
          {row.learning_map_opened_count}
        </td>
        <td className="px-4 py-3 text-center">
          {row.lesson_opened_count > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-gray-400 hover:text-brand-500 transition-colors"
              aria-label={t("analytics.lessonsOpened")}
            >
              {expanded ? (
                <ChevronUp size={16} />
              ) : (
                <ChevronDown size={16} />
              )}
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50/60">
          <td colSpan={6} className="px-4 py-3">
            {lessonEventsLoading ? (
              <p className="text-xs text-gray-400">{t("common.loading")}</p>
            ) : (
              <ul className="space-y-1">
                {lessonOpens.map((ev, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between text-xs text-gray-600"
                  >
                    <span>{ev.lesson_title ?? ev.lesson_id ?? "—"}</span>
                    <span className="text-gray-400">
                      {formatDateTime(ev.occurred_at, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
