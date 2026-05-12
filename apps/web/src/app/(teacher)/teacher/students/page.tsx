"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Copy,
  Loader2,
  Plus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface StudentRow {
  id: string;
  full_name: string;
  email: string;
  grade_level: string | null;
  unreviewed_difficulties: number;
}

export default function StudentsPage() {
  const t = useT();
  const qc = useQueryClient();

  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteGrade, setInviteGrade] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: students = [], isLoading } = useQuery<StudentRow[]>({
    queryKey: ["students"],
    queryFn: () => api.get("/students"),
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      api.post<{ invite_url: string }>("/students/invite", {
        full_name: inviteName.trim(),
        grade_level: inviteGrade.trim() || undefined,
      }),
    onSuccess: (data) => {
      setInviteLink(data.invite_url);
      setInviteName("");
      setInviteGrade("");
      qc.invalidateQueries({ queryKey: ["students"] });
    },
  });

  function copyLink() {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const needsAttention = students.filter((s) => s.unreviewed_difficulties > 0);
  const rest = students.filter((s) => s.unreviewed_difficulties === 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">
          {t("teacher.students")}
          {students.length > 0 && (
            <span className="ms-2 text-base font-normal text-gray-400">
              (
              {students.length === 1
                ? t("teacher.studentCount", { count: 1 })
                : t("teacher.studentCountPlural", {
                    count: students.length,
                  })}
              )
            </span>
          )}
        </h1>
        <button
          onClick={() => {
            setShowInvite((v) => !v);
            setInviteLink(null);
          }}
          className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg px-3 py-2 transition-colors"
        >
          <Plus size={15} />
          {t("teacher.inviteStudent")}
        </button>
      </div>

      {/* Invite form */}
      {showInvite && (
        <Card>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            {t("teacher.inviteTitle")}
          </h2>

          {inviteLink ? (
            <div className="space-y-3">
              <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                {t("teacher.inviteCreated", { name: inviteName || "…" })}
              </p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={inviteLink}
                  className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 font-mono truncate"
                />
                <button
                  onClick={copyLink}
                  className={cn(
                    "inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-2 border transition-colors",
                    copied
                      ? "bg-green-50 border-green-200 text-green-700"
                      : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                  )}
                >
                  <Copy size={14} />
                  {copied ? t("common.copied") : t("common.copy")}
                </button>
              </div>
              <button
                onClick={() => {
                  setInviteLink(null);
                  setShowInvite(false);
                }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                {t("common.close")}
              </button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                placeholder={t("common.fullName")}
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
              <input
                type="text"
                placeholder={t("teacher.gradeLevelOptional")}
                value={inviteGrade}
                onChange={(e) => setInviteGrade(e.target.value)}
                className="w-36 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
              <button
                disabled={!inviteName.trim() || inviteMutation.isPending}
                onClick={() => inviteMutation.mutate()}
                className="inline-flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
              >
                {inviteMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : null}
                {t("teacher.createInvite")}
              </button>
            </div>
          )}
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400">{t("common.loading")}</p>
      ) : students.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-xl bg-white">
          <div className="w-12 h-12 rounded-full bg-brand-50 mx-auto mb-3 flex items-center justify-center">
            <Users size={20} className="text-brand-500" />
          </div>
          <p className="text-sm text-gray-500">{t("teacher.noStudents")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Needs attention first */}
          {needsAttention.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-orange-500 px-1">
                {t("teacher.needsAttention")}
              </h2>
              {needsAttention.map((s) => (
                <StudentCard key={s.id} student={s} />
              ))}
            </section>
          )}

          {rest.length > 0 && (
            <section className="space-y-2">
              {needsAttention.length > 0 && (
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 px-1">
                  {t("teacher.allStudents")}
                </h2>
              )}
              {rest.map((s) => (
                <StudentCard key={s.id} student={s} />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function StudentCard({ student }: { student: StudentRow }) {
  const t = useT();
  return (
    <Link
      href={`/teacher/students/${student.id}`}
      className="flex items-center justify-between gap-3 bg-white border border-gray-100 rounded-xl px-4 py-3 hover:border-brand-200 hover:bg-brand-50/30 transition-colors group"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-gray-900 truncate">{student.full_name}</p>
          {student.unreviewed_difficulties > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-600 bg-orange-50 border border-orange-100 rounded-full px-2 py-0.5">
              <AlertTriangle size={11} />
              {t("teacher.unreviewedDifficulties", {
                count: student.unreviewed_difficulties,
              })}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 truncate mt-0.5">
          {student.grade_level ? `${student.grade_level} · ` : ""}
          {student.email}
        </p>
      </div>
      <ArrowLeft
        size={16}
        className="text-gray-300 group-hover:text-brand-400 flex-shrink-0 rtl:rotate-0 ltr:rotate-180 transition-colors"
      />
    </Link>
  );
}
