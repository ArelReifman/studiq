"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StudentCard } from "@/components/teacher/student-card";
import { formatDate } from "@/lib/utils";
import { useT } from "@/i18n";
import type { DifficultyReport } from "@studiq/types";
import { AlertTriangle, Users, UserPlus, X } from "lucide-react";

interface StudentRow {
  id: string;
  full_name: string;
  grade_level: string | null;
  avg_completion_rate: string | null;
  weak_topics: string[];
  ai_summary: string | null;
}

export default function TeacherDashboard() {
  const qc = useQueryClient();
  const t = useT();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    full_name: "",
  });
  const [inviteResult, setInviteResult] = useState<{
    invite_url: string;
    full_name: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: students = [] } = useQuery<StudentRow[]>({
    queryKey: ["students"],
    queryFn: () => api.get("/students"),
  });

  const { data: difficulties = [] } = useQuery<
    (DifficultyReport & { student_name: string })[]
  >({
    queryKey: ["difficulties"],
    queryFn: () => api.get("/difficulties"),
    refetchInterval: 30_000,
  });

  const unreviewed = difficulties.filter((d) => !d.reviewed);

  const inviteMutation = useMutation({
    mutationFn: (body: typeof inviteForm) => api.post("/students/invite", body),
    onSuccess: (data: any) => {
      setInviteResult({
        invite_url: data.invite_url,
        full_name: data.full_name,
      });
    },
  });

  const markReviewed = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/difficulties/${id}`, { reviewed: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["difficulties"] }),
  });

  const studentCountText =
    students.length === 1
      ? t("teacher.studentCount", { count: students.length })
      : t("teacher.studentCountPlural", { count: students.length });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t("teacher.dashboard")}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{studentCountText}</p>
        </div>
        <Button onClick={() => setShowInvite(true)}>
          <UserPlus size={15} /> {t("teacher.inviteStudent")}
        </Button>
      </div>

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">{t("teacher.inviteTitle")}</h2>
              <button
                onClick={() => {
                  setShowInvite(false);
                  setInviteResult(null);
                }}
              >
                <X size={18} className="text-gray-400" />
              </button>
            </div>

            {inviteResult ? (
              <div>
                <p className="text-sm text-green-700 bg-green-50 rounded-lg p-3 mb-3">
                  {t("teacher.inviteCreated", {
                    name: inviteResult.full_name,
                  })}
                </p>
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {t("teacher.inviteLink")}
                  </label>
                  <div className="bg-gray-50 border rounded-lg p-2 text-xs font-mono break-all text-gray-700">
                    {inviteResult.invite_url}
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={async () => {
                    await navigator.clipboard.writeText(
                      inviteResult.invite_url
                    );
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? t("teacher.copied") : t("teacher.copyLink")}
                </Button>
                <Button
                  className="mt-2 w-full"
                  variant="secondary"
                  onClick={() => {
                    setShowInvite(false);
                    setInviteResult(null);
                    setInviteForm({ full_name: "" });
                  }}
                >
                  {t("common.done")}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("teacher.fullName")}
                  </label>
                  <input
                    type="text"
                    value={inviteForm.full_name}
                    onChange={(e) =>
                      setInviteForm((p) => ({
                        ...p,
                        full_name: e.target.value,
                      }))
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={!inviteForm.full_name || inviteMutation.isPending}
                  onClick={() => inviteMutation.mutate(inviteForm)}
                >
                  {inviteMutation.isPending
                    ? t("teacher.creating")
                    : t("teacher.createInvite")}
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Students grid */}
        <div className="lg:col-span-2">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {students.map((s) => (
                <StudentCard key={s.id} {...s} />
              ))}
            </div>
          )}
        </div>

        {/* Difficulty alerts */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-red-400" />
            <h2 className="font-semibold text-sm text-gray-600">
              {t("teacher.difficulties")}
              {unreviewed.length > 0 && (
                <Badge variant="danger" className="ms-2">
                  {unreviewed.length} {t("teacher.new")}
                </Badge>
              )}
            </h2>
          </div>

          <div className="space-y-2">
            {difficulties.slice(0, 10).map((d) => (
              <Card key={d.id} className="p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 truncate">
                      {d.student_name}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                      {d.description}
                    </p>
                    {d.topic_tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {d.topic_tags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="warning"
                            className="text-xs"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-gray-300 mt-1">
                      {formatDate(d.created_at)}
                    </p>
                  </div>
                  {!d.reviewed && (
                    <button
                      onClick={() => markReviewed.mutate(d.id)}
                      className="ms-2 text-xs text-gray-400 hover:text-green-500 flex-shrink-0"
                    >
                      ✓
                    </button>
                  )}
                </div>
              </Card>
            ))}

            {difficulties.length === 0 && (
              <Card>
                <p className="text-gray-400 text-sm text-center py-2">
                  {t("teacher.noDifficulties")}
                </p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
