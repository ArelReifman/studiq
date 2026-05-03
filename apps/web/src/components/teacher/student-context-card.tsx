"use client";

/**
 * Student Context Card — two-section panel on the student detail page that
 * captures teacher-curated knowledge:
 *
 *   1. Background  — static context (learning needs, family, personality)
 *                    written once at onboarding, edited rarely.
 *   2. Insights    — append-only log of "what helps this student" — each
 *                    insight is a one-line observation discovered while
 *                    teaching. Old insights stay so we can see how
 *                    understanding of the student evolved.
 *
 * Both fields feed directly into the AI's profile-update prompt so the
 * model personalizes recommendations beyond raw performance numbers.
 *
 * Replaces the previous free-form "feedback to digital teacher" form,
 * which was ambiguous and not tied to any persistent student context.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Save, Check } from "lucide-react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import type { StudentInsight } from "@studiq/types";

interface StudentContextCardProps {
  studentId: string;
  initialBackground: string | null;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}`;
}

export function StudentContextCard({
  studentId,
  initialBackground,
}: StudentContextCardProps) {
  const t = useT();
  const qc = useQueryClient();

  // ── Background (single editable field, save on demand) ──────────────────
  const [background, setBackground] = useState(initialBackground ?? "");
  const [bgSaved, setBgSaved] = useState(false);
  const isBgDirty =
    background.trim() !== (initialBackground ?? "").trim();

  const saveBackground = useMutation({
    mutationFn: () =>
      api.patch(`/students/${studentId}/background`, {
        background_note: background,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["students", studentId] });
      setBgSaved(true);
      setTimeout(() => setBgSaved(false), 2000);
    },
  });

  // ── Insights (append-only log; newest first) ────────────────────────────
  const { data: insights = [] } = useQuery<StudentInsight[]>({
    queryKey: ["students", studentId, "insights"],
    queryFn: () => api.get(`/students/${studentId}/insights`),
  });

  const [newInsight, setNewInsight] = useState("");

  const addInsight = useMutation({
    mutationFn: () =>
      api.post(`/students/${studentId}/insights`, {
        content: newInsight.trim(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["students", studentId, "insights"] });
      setNewInsight("");
    },
  });

  const removeInsight = useMutation({
    mutationFn: (insightId: string) =>
      api.delete(`/students/${studentId}/insights/${insightId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["students", studentId, "insights"] });
    },
  });

  return (
    <Card className="space-y-5">
      {/* ── Background section ────────────────────────────────────────── */}
      <div>
        <h2 className="font-semibold text-sm text-gray-600 mb-1">
          {t("studentContext.backgroundTitle")}
        </h2>
        <p className="text-xs text-gray-400 mb-2">
          {t("studentContext.backgroundHint")}
        </p>
        <textarea
          value={background}
          onChange={(e) => setBackground(e.target.value)}
          placeholder={t("studentContext.backgroundPlaceholder")}
          rows={4}
          maxLength={4000}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-gray-400">
            {background.length}/4000
          </span>
          <div className="flex items-center gap-2">
            {bgSaved && (
              <span className="inline-flex items-center gap-1 text-xs text-green-600">
                <Check size={12} /> {t("studentContext.saved")}
              </span>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={!isBgDirty || saveBackground.isPending}
              onClick={() => saveBackground.mutate()}
            >
              <Save size={13} />
              {saveBackground.isPending
                ? t("studentContext.saving")
                : t("studentContext.saveBackground")}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Insights section ──────────────────────────────────────────── */}
      <div className="border-t border-gray-100 pt-4">
        <h2 className="font-semibold text-sm text-gray-600 mb-1">
          {t("studentContext.insightsTitle")}
        </h2>
        <p className="text-xs text-gray-400 mb-3">
          {t("studentContext.insightsHint")}
        </p>

        {/* Add new insight */}
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newInsight}
            onChange={(e) => setNewInsight(e.target.value)}
            placeholder={t("studentContext.insightPlaceholder")}
            maxLength={500}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newInsight.trim() && !addInsight.isPending) {
                addInsight.mutate();
              }
            }}
          />
          <Button
            size="sm"
            disabled={!newInsight.trim() || addInsight.isPending}
            onClick={() => addInsight.mutate()}
          >
            <Plus size={14} />
            {t("studentContext.addInsight")}
          </Button>
        </div>

        {/* Insight list */}
        {insights.length === 0 ? (
          <p className="text-xs text-gray-400 italic">
            {t("studentContext.insightsEmpty")}
          </p>
        ) : (
          <ul className="space-y-2">
            {insights.map((ins) => (
              <li
                key={ins.id}
                className="group flex items-start gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2"
              >
                <span className="flex-1 text-gray-700">{ins.content}</span>
                <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">
                  {formatShortDate(ins.created_at)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(t("studentContext.confirmDelete"))) {
                      removeInsight.mutate(ins.id);
                    }
                  }}
                  disabled={removeInsight.isPending}
                  className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                  aria-label={t("studentContext.removeInsight")}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
