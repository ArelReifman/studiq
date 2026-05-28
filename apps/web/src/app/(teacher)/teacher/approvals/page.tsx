"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, Mail, Clock, MessageSquare, CalendarClock, UserPlus, AlertTriangle, BookOpen } from "lucide-react";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { groupConsecutiveBookings, formatDurationI18n } from "@/lib/booking-grouping";

interface PendingProfile {
  id: string;
  email: string;
  full_name: string;
  signup_note: string | null;
  signup_course_id: string | null;
  signup_course_name: string | null;
  created_at: string;
}

interface PendingBooking {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  student_note: string | null;
  student_name: string;
  student_id: string;
  created_at: string;
  /** Course associated with this lesson. Null for legacy lessons. */
  course_id?: string | null;
  /** GCal event id — needed so groupConsecutiveBookings splits distinct lessons. */
  gcal_event_id?: string | null;
}

function formatBookingDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function ApprovalsPage() {
  const t = useT();
  const qc = useQueryClient();

  // Per-row UI state
  const [actionState, setActionState] = useState<Record<string, "approve" | "reject" | undefined>>({});
  const [rowInputs, setRowInputs] = useState<Record<string, { grade_level?: string; notes?: string }>>({});
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});

  const { data: registrations, isLoading: regLoading } = useQuery<{ pending: PendingProfile[] }>({
    queryKey: ["approvals-registrations"],
    queryFn: () => api.get("/approvals"),
  });

  const { data: bookings = [], isLoading: bookLoading } = useQuery<PendingBooking[]>({
    queryKey: ["approvals-bookings"],
    queryFn: () => api.get("/bookings/requests"),
  });

  const pendingRegs = registrations?.pending ?? [];
  const pendingBookings = bookings.filter((b) => b.status === "pending");
  const cancelRequests = bookings.filter((b) => b.status === "cancel_requested");
  // Merge consecutive slots from the same student into a single visual row.
  const pendingGroups = useMemo(
    () => groupConsecutiveBookings(pendingBookings),
    [pendingBookings]
  );
  const cancelGroups = useMemo(
    () => groupConsecutiveBookings(cancelRequests),
    [cancelRequests]
  );
  // Count groups (lessons), not individual 30-min slots.
  const totalPending =
    pendingRegs.length + pendingGroups.length + cancelGroups.length;

  // ── Registration approval ─────────────────────────────────────
  const approveReg = useMutation({
    mutationFn: (id: string) => {
      const inputs = rowInputs[id] ?? {};
      return api.post(`/approvals/${id}/approve`, {
        grade_level: inputs.grade_level || undefined,
        notes: inputs.notes || undefined,
      });
    },
    onMutate: (id) => setActionState((s) => ({ ...s, [id]: "approve" })),
    onSettled: (_d, _e, id) => setActionState((s) => ({ ...s, [id]: undefined })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals-registrations"] });
      // Approving a registration adds a new student → refresh roster lists.
      qc.invalidateQueries({ queryKey: ["students"] });
    },
  });

  const rejectReg = useMutation({
    mutationFn: (id: string) => api.post(`/approvals/${id}/reject`, {}),
    onMutate: (id) => setActionState((s) => ({ ...s, [id]: "reject" })),
    onSettled: (_d, _e, id) => setActionState((s) => ({ ...s, [id]: undefined })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals-registrations"] });
      qc.invalidateQueries({ queryKey: ["students"] });
    },
  });

  // ── Booking approval (acts on every slot in a consecutive group) ─────────
  // The endpoint covers both original-approval AND cancellation-confirm flows.
  // `action` ("approve" | "reject") is independent of `status` because in the
  // cancel section "Keep lesson" sends status=approved but visually maps to a
  // reject of the cancellation request.
  //
  // Optimistic UI is engaged ONLY for the original "approve a new pending
  // request" path (action === "approve" && status === "approved"). All other
  // combinations (reject, confirm-cancellation, keep-lesson) keep the
  // previous behavior — the action-state spinner is the only optimistic
  // touch, and the real cache updates land on `onSuccess` after refetch.
  const respondBookingGroup = useMutation({
    mutationFn: async ({
      ids,
      status,
      note,
    }: {
      groupKey: string;
      ids: string[];
      status: "approved" | "rejected" | "cancelled";
      action: "approve" | "reject";
      note?: string;
    }) => {
      // One atomic request for the whole group → one gcal event on approval
      await api.patch("/bookings/batch-status", { ids, status, note });
    },
    onMutate: async (vars) => {
      setActionState((s) => ({ ...s, [vars.groupKey]: vars.action }));

      // Non-approve paths: keep current (non-optimistic) behavior.
      if (vars.action !== "approve" || vars.status !== "approved") {
        return { optimistic: false as const };
      }

      const apprKey = ["approvals-bookings"] as const;
      const bookKey = ["my-bookings-as-teacher"] as const;
      // Cancel any concurrent refetches so they can't overwrite our
      // optimistic snapshots mid-mutation.
      await qc.cancelQueries({ queryKey: apprKey });
      await qc.cancelQueries({ queryKey: bookKey });

      const apprSnapshot = qc.getQueryData<PendingBooking[]>(apprKey);
      // We don't import the schedule page's BookingRow type — cache it as
      // an array of unknown so the schedule page can read whatever fields
      // it needs. The real shape comes back on the next refetch.
      const bookSnapshot = qc.getQueryData<unknown[]>(bookKey);

      // Build the rows that should appear in the teacher's schedule.
      // Carry over every field already loaded for approvals so the
      // schedule's grouping (student_id + date + consecutive times +
      // gcal_event_id + course_id) still collapses multi-slot lessons
      // correctly. Only mutate: status (→ approved), calendar_sync_status
      // (→ pending so the schedule shows "⏳ מסתנכרן ליומן…"), and
      // teacher_note (if provided).
      const approvedRows = (apprSnapshot ?? [])
        .filter((r) => vars.ids.includes(r.id))
        .map((r) => ({
          ...r,
          status: "approved" as const,
          calendar_sync_status: "pending" as const,
          attendance: null,
          teacher_note: vars.note?.trim() ? vars.note.trim() : null,
        }));

      qc.setQueryData<PendingBooking[]>(apprKey, (prev) =>
        (prev ?? []).filter((r) => !vars.ids.includes(r.id))
      );
      qc.setQueryData<unknown[]>(bookKey, (prev) => [
        ...approvedRows,
        ...(prev ?? []),
      ]);

      return { optimistic: true as const, apprSnapshot, bookSnapshot };
    },
    onError: (err: Error, _vars, context) => {
      // Roll back both caches if we touched them optimistically.
      if (context?.optimistic) {
        if (context.apprSnapshot !== undefined) {
          qc.setQueryData(["approvals-bookings"], context.apprSnapshot);
        }
        if (context.bookSnapshot !== undefined) {
          qc.setQueryData(["my-bookings-as-teacher"], context.bookSnapshot);
        }
      }
      // Surface the backend's reason — no internal-error leakage path is
      // involved because batch-status returns its own clean messages.
      window.alert(err.message);
    },
    onSettled: (_d, _e, { groupKey }) =>
      setActionState((s) => ({ ...s, [groupKey]: undefined })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals-bookings"] });
      qc.invalidateQueries({ queryKey: ["my-availability"] });
      qc.invalidateQueries({ queryKey: ["booking-slots"] });
      qc.invalidateQueries({ queryKey: ["my-bookings-as-teacher"] });
    },
  });

  function setInput(id: string, key: "grade_level" | "notes", value: string) {
    setRowInputs((p) => ({ ...p, [id]: { ...p[id], [key]: value } }));
  }

  const isLoading = regLoading || bookLoading;

  return (
    <div className="space-y-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t("approvals.title")}</h1>
        {totalPending > 0 && (
          <span className="inline-flex items-center gap-1 text-sm text-amber-700 bg-amber-50 border border-amber-100 px-3 py-1 rounded-full font-medium">
            <Clock size={14} /> {totalPending}
          </span>
        )}
      </div>

      {isLoading && (
        <div className="text-sm text-gray-400 py-12 text-center">{t("common.loading")}</div>
      )}

      {!isLoading && totalPending === 0 && (
        <Card className="text-center py-12">
          <div className="w-12 h-12 rounded-full bg-green-50 border border-green-100 flex items-center justify-center mx-auto mb-3">
            <Check size={20} className="text-green-600" />
          </div>
          <p className="text-sm text-gray-500">{t("approvals.empty")}</p>
        </Card>
      )}

      {/* ─── Lesson booking requests ─── */}
      {pendingGroups.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-brand-500" />
            <h2 className="text-base font-semibold text-gray-800">
              {t("approvals.bookingRequests")}
            </h2>
            <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-medium">
              {pendingGroups.length}
            </span>
          </div>

          {pendingGroups.map((g) => {
            const busy = actionState[g.key];
            return (
              <Card key={g.key}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 truncate mb-1">
                      {g.student_name}
                    </div>
                    {/* Date — pure Hebrew, RTL */}
                    <div className="flex items-baseline gap-1.5 text-sm text-gray-600">
                      <span className="text-xs text-gray-400 shrink-0">
                        {t("approvals.labelDate")}:
                      </span>
                      <span dir="rtl">{formatBookingDate(g.date)}</span>
                    </div>
                    {/* Time range — LTR so 17:30–19:00 renders correctly */}
                    <div className="flex items-baseline gap-1.5 text-sm text-gray-600 mt-0.5">
                      <span className="text-xs text-gray-400 shrink-0">
                        {t("approvals.labelTime")}:
                      </span>
                      <span dir="ltr" className="font-mono">
                        {g.start_time}–{g.end_time}
                      </span>
                    </div>
                    {/* Duration */}
                    <div className="flex items-baseline gap-1.5 text-sm text-gray-600 mt-0.5">
                      <span className="text-xs text-gray-400 shrink-0">
                        {t("approvals.labelDuration")}:
                      </span>
                      <span className="text-xs font-medium text-brand-700">
                        {formatDurationI18n(g.hours, t)}
                      </span>
                    </div>
                  </div>
                  <span className="text-[11px] text-gray-400 whitespace-nowrap">
                    {new Date(g.bookings[0]!.created_at).toLocaleDateString()}
                  </span>
                </div>

                {g.student_note && (
                  <div className="mb-3 bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs text-gray-700">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                      <MessageSquare size={10} /> {t("approvals.studentNote")}
                    </div>
                    {g.student_note}
                  </div>
                )}

                <input
                  type="text"
                  placeholder={t("approvals.optionalNote")}
                  value={rejectNotes[g.key] ?? ""}
                  onChange={(e) =>
                    setRejectNotes((p) => ({ ...p, [g.key]: e.target.value }))
                  }
                  className="w-full text-sm border border-gray-200 rounded-md px-3 py-1.5 mb-3 focus:outline-none focus:ring-1 focus:ring-brand-300"
                />

                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      respondBookingGroup.mutate({
                        groupKey: g.key,
                        ids: g.ids,
                        status: "approved",
                        action: "approve",
                        note: rejectNotes[g.key] || undefined,
                      })
                    }
                    disabled={!!busy}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-60 transition-colors"
                  >
                    <Check size={15} />
                    {busy === "approve" ? t("approvals.approving") : t("approvals.approve")}
                  </button>
                  <button
                    onClick={() =>
                      respondBookingGroup.mutate({
                        groupKey: g.key,
                        ids: g.ids,
                        status: "rejected",
                        action: "reject",
                        note: rejectNotes[g.key] || undefined,
                      })
                    }
                    disabled={!!busy}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-white border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:opacity-60 transition-colors"
                  >
                    <X size={15} />
                    {busy === "reject" ? t("approvals.rejecting") : t("approvals.reject")}
                  </button>
                </div>
              </Card>
            );
          })}
        </section>
      )}

      {/* ─── Cancellation requests ─── */}
      {cancelGroups.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-500" />
            <h2 className="text-base font-semibold text-gray-800">
              {t("approvals.cancellationRequests")}
            </h2>
            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
              {cancelGroups.length}
            </span>
          </div>

          {cancelGroups.map((g) => {
            const busy = actionState[g.key];
            return (
              <Card key={g.key}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 truncate mb-1">
                      {g.student_name}
                    </div>
                    {/* Date — pure Hebrew, RTL */}
                    <div className="flex items-baseline gap-1.5 text-sm text-gray-600">
                      <span className="text-xs text-gray-400 shrink-0">
                        {t("approvals.labelDate")}:
                      </span>
                      <span dir="rtl">{formatBookingDate(g.date)}</span>
                    </div>
                    {/* Time range — LTR so 17:30–19:00 renders correctly */}
                    <div className="flex items-baseline gap-1.5 text-sm text-gray-600 mt-0.5">
                      <span className="text-xs text-gray-400 shrink-0">
                        {t("approvals.labelTime")}:
                      </span>
                      <span dir="ltr" className="font-mono">
                        {g.start_time}–{g.end_time}
                      </span>
                    </div>
                    {/* Duration */}
                    <div className="flex items-baseline gap-1.5 text-sm text-gray-600 mt-0.5">
                      <span className="text-xs text-gray-400 shrink-0">
                        {t("approvals.labelDuration")}:
                      </span>
                      <span className="text-xs font-medium text-brand-700">
                        {formatDurationI18n(g.hours, t)}
                      </span>
                    </div>
                    <p className="text-xs text-red-600 mt-1.5">
                      {t("approvals.studentRequestedCancel")}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      respondBookingGroup.mutate({
                        groupKey: g.key,
                        ids: g.ids,
                        status: "cancelled",
                        action: "approve",
                      })
                    }
                    disabled={!!busy}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 transition-colors"
                  >
                    <Check size={15} />
                    {busy === "approve"
                      ? t("approvals.approving")
                      : t("approvals.confirmCancel")}
                  </button>
                  <button
                    onClick={() =>
                      respondBookingGroup.mutate({
                        groupKey: g.key,
                        ids: g.ids,
                        status: "approved",
                        action: "reject",
                      })
                    }
                    disabled={!!busy}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-white border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-60 transition-colors"
                  >
                    <X size={15} />
                    {busy === "reject"
                      ? t("approvals.rejecting")
                      : t("approvals.keepLesson")}
                  </button>
                </div>
              </Card>
            );
          })}
        </section>
      )}

      {/* ─── Registration requests ─── */}
      {pendingRegs.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <UserPlus size={16} className="text-brand-500" />
            <h2 className="text-base font-semibold text-gray-800">
              {t("approvals.registrationRequests")}
            </h2>
            <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-medium">
              {pendingRegs.length}
            </span>
          </div>

          {pendingRegs.map((u) => {
            const busy = actionState[u.id];
            return (
              <Card key={u.id}>
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

                {u.signup_course_name && (
                  <div className="mb-3 inline-flex items-center gap-1.5 bg-brand-50 border border-brand-100 rounded-lg px-3 py-1.5 text-xs text-brand-800">
                    <BookOpen size={11} className="text-brand-600" />
                    <span className="font-medium">
                      {t("approvals.signupCourseLabel")}:
                    </span>
                    <span className="font-semibold">{u.signup_course_name}</span>
                  </div>
                )}

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
                    onClick={() => approveReg.mutate(u.id)}
                    disabled={!!busy}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-60 transition-colors"
                  >
                    <Check size={15} />
                    {busy === "approve" ? t("approvals.approving") : t("approvals.approve")}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(t("approvals.confirmReject"))) rejectReg.mutate(u.id);
                    }}
                    disabled={!!busy}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-white border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:opacity-60 transition-colors"
                  >
                    <X size={15} />
                    {busy === "reject" ? t("approvals.rejecting") : t("approvals.reject")}
                  </button>
                </div>
              </Card>
            );
          })}
        </section>
      )}
    </div>
  );
}
