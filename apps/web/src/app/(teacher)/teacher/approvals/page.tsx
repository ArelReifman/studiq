"use client";

import { useEffect, useState } from "react";
import { Check, X, Mail, Clock, MessageSquare } from "lucide-react";
import { api } from "@/lib/api";
import { useT } from "@/i18n";

interface PendingProfile {
  id: string;
  email: string;
  full_name: string;
  signup_note: string | null;
  created_at: string;
}

export default function ApprovalsPage() {
  const t = useT();
  const [pending, setPending] = useState<PendingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  // Per-row action state — distinct from the page-level loading flag.
  // Tracks which row is mid-approve / mid-reject so we can disable just
  // that row's buttons without freezing the whole list.
  const [actionState, setActionState] = useState<Record<string, "approve" | "reject" | undefined>>({});
  // Per-row inputs — kept in component state, not the API payload, so the
  // teacher can edit notes before approving without committing to anything.
  const [rowInputs, setRowInputs] = useState<Record<string, { grade_level?: string; notes?: string }>>({});

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      const data = await api.get<{ pending: PendingProfile[] }>("/approvals");
      setPending(data.pending);
    } finally {
      setLoading(false);
    }
  }

  async function approve(id: string) {
    setActionState((s) => ({ ...s, [id]: "approve" }));
    try {
      const inputs = rowInputs[id] ?? {};
      await api.post(`/approvals/${id}/approve`, {
        grade_level: inputs.grade_level || undefined,
        notes: inputs.notes || undefined,
      });
      setPending((p) => p.filter((u) => u.id !== id));
    } catch (err: any) {
      alert(err.message ?? "Failed to approve");
    } finally {
      setActionState((s) => ({ ...s, [id]: undefined }));
    }
  }

  async function reject(id: string) {
    if (!confirm(t("approvals.confirmReject"))) return;
    setActionState((s) => ({ ...s, [id]: "reject" }));
    try {
      await api.post(`/approvals/${id}/reject`, {});
      setPending((p) => p.filter((u) => u.id !== id));
    } catch (err: any) {
      alert(err.message ?? "Failed to reject");
    } finally {
      setActionState((s) => ({ ...s, [id]: undefined }));
    }
  }

  function setInput(id: string, key: "grade_level" | "notes", value: string) {
    setRowInputs((p) => ({ ...p, [id]: { ...p[id], [key]: value } }));
  }

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t("approvals.title")}</h1>
        {pending.length > 0 && (
          <span className="inline-flex items-center gap-1 text-sm text-amber-700 bg-amber-50 border border-amber-100 px-3 py-1 rounded-full font-medium">
            <Clock size={14} /> {pending.length}
          </span>
        )}
      </div>

      {loading && (
        <div className="text-sm text-gray-400 py-12 text-center">Loading...</div>
      )}

      {!loading && pending.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-green-50 border border-green-100 flex items-center justify-center mx-auto mb-3">
            <Check size={20} className="text-green-600" />
          </div>
          <p className="text-sm text-gray-500">{t("approvals.empty")}</p>
        </div>
      )}

      <div className="space-y-3">
        {pending.map((u) => {
          const busy = actionState[u.id];
          return (
            <div
              key={u.id}
              className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 truncate">{u.full_name}</div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5">
                    <Mail size={12} /> {u.email}
                  </div>
                </div>
                <span className="text-[11px] text-gray-400 whitespace-nowrap">
                  {new Date(u.created_at).toLocaleDateString()}
                </span>
              </div>

              {u.signup_note && (
                <div className="mb-3 bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs text-gray-700">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                    <MessageSquare size={10} /> {t("approvals.signupNoteLabel")}
                  </div>
                  {u.signup_note}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                <input
                  type="text"
                  placeholder={t("approvals.gradeLevel")}
                  value={rowInputs[u.id]?.grade_level ?? ""}
                  onChange={(e) => setInput(u.id, "grade_level", e.target.value)}
                  className="text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-300"
                />
                <input
                  type="text"
                  placeholder={t("approvals.notes")}
                  value={rowInputs[u.id]?.notes ?? ""}
                  onChange={(e) => setInput(u.id, "notes", e.target.value)}
                  className="text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-300"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => approve(u.id)}
                  disabled={!!busy}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-60 transition-colors"
                >
                  <Check size={15} />
                  {busy === "approve" ? t("approvals.approving") : t("approvals.approve")}
                </button>
                <button
                  onClick={() => reject(u.id)}
                  disabled={!!busy}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-white border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:opacity-60 transition-colors"
                >
                  <X size={15} />
                  {busy === "reject" ? t("approvals.rejecting") : t("approvals.reject")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
