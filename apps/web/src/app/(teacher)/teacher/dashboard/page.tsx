"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { useT } from "@/i18n";
import { groupConsecutiveBookings, formatDuration } from "@/lib/booking-grouping";
import {
  AlertTriangle,
  CalendarCheck,
  Clock,
  FileText,
  CheckCircle2,
  ArrowLeft,
  BookOpen,
  ArrowRight,
  Users,
} from "lucide-react";

interface BookingRow {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  status:
    | "pending"
    | "approved"
    | "rejected"
    | "cancel_requested"
    | "cancelled";
  student_note: string | null;
  teacher_note: string | null;
  attendance: "attended" | "no_show" | null;
  created_at: string;
  student_name: string;
  student_id: string;
}

interface HomeworkSubmission {
  id: string;
  title: string;
  file_url: string;
  file_name: string | null;
  created_at: string;
  student_id: string;
  student_name: string;
}

interface StudentRow {
  id: string;
  full_name: string;
  unreviewed_difficulties: number;
}

function hasLessonEnded(date: string, endTime: string): boolean {
  return new Date(`${date}T${endTime}:00`).getTime() <= Date.now();
}

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function getTomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatTime(t: string) {
  return t.slice(0, 5);
}

export default function TeacherDashboard() {
  const t = useT();

  const { data: bookings = [] } = useQuery<BookingRow[]>({
    queryKey: ["bookings", "requests"],
    queryFn: () => api.get("/bookings/requests"),
  });

  const { data: submissions = [] } = useQuery<HomeworkSubmission[]>({
    queryKey: ["homework", "pending-submissions"],
    queryFn: () => api.get("/homework/pending-submissions"),
  });

  const { data: students = [] } = useQuery<StudentRow[]>({
    queryKey: ["students"],
    queryFn: () => api.get("/students"),
  });

  const today = getTodayStr();
  const tomorrow = getTomorrowStr();

  // ── Action items ────────────────────────────────────────────────────────────
  const pendingRequests = useMemo(
    () =>
      groupConsecutiveBookings(
        bookings.filter(
          (b) => b.status === "pending" || b.status === "cancel_requested"
        )
      ),
    [bookings]
  );

  const attendanceNeeded = useMemo(
    () =>
      groupConsecutiveBookings(
        bookings.filter(
          (b) =>
            b.status === "approved" &&
            hasLessonEnded(b.date, b.end_time) &&
            b.attendance === null
        )
      ),
    [bookings]
  );

  const studentsNeedingAttention = useMemo(
    () => students.filter((s) => s.unreviewed_difficulties > 0),
    [students]
  );

  // ── Today / tomorrow schedule ───────────────────────────────────────────────
  const todayGroups = useMemo(
    () =>
      groupConsecutiveBookings(
        bookings.filter((b) => b.status === "approved" && b.date === today)
      ).sort((a, b) => a.start_time.localeCompare(b.start_time)),
    [bookings, today]
  );

  const tomorrowGroups = useMemo(
    () =>
      groupConsecutiveBookings(
        bookings.filter((b) => b.status === "approved" && b.date === tomorrow)
      ).sort((a, b) => a.start_time.localeCompare(b.start_time)),
    [bookings, tomorrow]
  );

  const totalActionItems =
    pendingRequests.length +
    attendanceNeeded.length +
    studentsNeedingAttention.length;
  const totalWithSubmissions = totalActionItems + submissions.length;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t("teacher.dashboard")}</h1>

      {/* ── B: Action items ─────────────────────────────────────────────────── */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-base font-semibold text-gray-800">
            {t("teacher.actionRequired")}
          </h2>
          {totalWithSubmissions > 0 && (
            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
              {totalWithSubmissions}
            </span>
          )}
        </div>

        {totalWithSubmissions === 0 ? (
          <div className="flex items-center gap-2 text-sm text-green-700 py-1">
            <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
            {t("teacher.allClear")}
          </div>
        ) : (
          <div className="space-y-2">
            {/* Pending lesson / cancel requests */}
            {pendingRequests.length > 0 && (
              <Link
                href="/teacher/approvals"
                className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 hover:bg-amber-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Clock
                    size={16}
                    className="text-amber-600 flex-shrink-0"
                  />
                  <span className="text-sm text-amber-900 font-medium">
                    {pendingRequests.length === 1
                      ? t("teacher.pendingRequestsSingle")
                      : t("teacher.pendingRequestsPlural", {
                          count: pendingRequests.length,
                        })}
                  </span>
                </div>
                <ArrowLeft size={14} className="text-amber-500 rtl:rotate-180" />
              </Link>
            )}

            {/* Attendance not yet marked */}
            {attendanceNeeded.length > 0 && (
              <Link
                href="/teacher/schedule"
                className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 hover:bg-blue-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <CalendarCheck
                    size={16}
                    className="text-blue-600 flex-shrink-0"
                  />
                  <span className="text-sm text-blue-900 font-medium">
                    {attendanceNeeded.length === 1
                      ? t("teacher.attendanceNeededSingle")
                      : t("teacher.attendanceNeededPlural", {
                          count: attendanceNeeded.length,
                        })}
                  </span>
                </div>
                <ArrowLeft size={14} className="text-blue-500 rtl:rotate-180" />
              </Link>
            )}

            {/* Unreviewed difficulties — one row per student */}
            {studentsNeedingAttention.map((s) => (
              <Link
                key={s.id}
                href={`/teacher/students/${s.id}`}
                className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 hover:bg-orange-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle
                    size={16}
                    className="text-orange-500 flex-shrink-0"
                  />
                  <span className="text-sm text-orange-900 font-medium">
                    {s.full_name} —{" "}
                    {t("teacher.unreviewedDifficulties", {
                      count: s.unreviewed_difficulties,
                    })}
                  </span>
                </div>
                <ArrowLeft size={14} className="text-orange-400 rtl:rotate-180" />
              </Link>
            ))}

            {/* Homework submissions */}
            {submissions.length > 0 && (
              <div className="flex items-center gap-3 rounded-lg border border-purple-200 bg-purple-50 px-4 py-3">
                <FileText
                  size={16}
                  className="text-purple-600 flex-shrink-0"
                />
                <span className="text-sm text-purple-900 font-medium">
                  {submissions.length === 1
                    ? t("teacher.submissionsSingle", {
                        name: submissions[0]!.student_name,
                      })
                    : t("teacher.submissionsPlural", {
                        count: submissions.length,
                      })}
                </span>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── C: Today & tomorrow ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Today */}
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <CalendarCheck size={15} className="text-brand-500" />
            <h2 className="text-sm font-semibold text-gray-700">
              {t("teacher.todayLessons")}
            </h2>
            {todayGroups.length > 0 && (
              <span className="text-xs bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded-full font-medium">
                {todayGroups.length}
              </span>
            )}
          </div>
          {todayGroups.length === 0 ? (
            <p className="text-xs text-gray-400">{t("teacher.noTodayLessons")}</p>
          ) : (
            <div className="space-y-2">
              {todayGroups.map((g) => (
                <div
                  key={g.key}
                  className="flex items-center gap-3"
                >
                  <span className="font-mono text-xs text-gray-500 flex-shrink-0 w-24" dir="ltr">
                    {formatTime(g.start_time)}–{formatTime(g.end_time)}
                  </span>
                  <span className="text-sm font-medium text-gray-800 truncate flex-1">
                    {g.student_name}
                  </span>
                  {g.hours > 1 && (
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {formatDuration(g.start_time, g.end_time)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Tomorrow */}
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <CalendarCheck size={15} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-700">
              {t("teacher.tomorrowLessons")}
            </h2>
            {tomorrowGroups.length > 0 && (
              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full font-medium">
                {tomorrowGroups.length}
              </span>
            )}
          </div>
          {tomorrowGroups.length === 0 ? (
            <p className="text-xs text-gray-400">
              {t("teacher.noTomorrowLessons")}
            </p>
          ) : (
            <div className="space-y-2">
              {tomorrowGroups.map((g) => (
                <div key={g.key} className="flex items-center gap-3">
                  <span className="font-mono text-xs text-gray-500 flex-shrink-0 w-24" dir="ltr">
                    {formatTime(g.start_time)}–{formatTime(g.end_time)}
                  </span>
                  <span className="text-sm font-medium text-gray-800 truncate flex-1">
                    {g.student_name}
                  </span>
                  {g.hours > 1 && (
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {formatDuration(g.start_time, g.end_time)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Empty state — no students at all */}
      {students.length === 0 && (
        <div className="text-center py-12 border border-dashed border-gray-200 rounded-xl bg-white">
          <div className="w-12 h-12 rounded-full bg-brand-50 mx-auto mb-3 flex items-center justify-center">
            <Users size={20} className="text-brand-500" />
          </div>
          <h3 className="text-base font-semibold text-gray-700 mb-1">
            {t("teacher.noStudentsTitle")}
          </h3>
          <p className="text-sm text-gray-500 mb-5 max-w-sm mx-auto">
            {t("teacher.noStudentsBody")}
          </p>
          <div className="inline-flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/teacher/courses"
              className="inline-flex items-center gap-1.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
            >
              <BookOpen size={14} />
              {t("teacher.noStudentsCtaCourses")}
            </Link>
            <Link
              href="/teacher/approvals"
              className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-brand-700 hover:bg-brand-50 rounded-lg px-4 py-2 transition-colors"
            >
              {t("teacher.noStudentsCtaApprovals")}
              <ArrowRight size={13} className="rtl:rotate-180" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
