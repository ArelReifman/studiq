"use client";

import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth";
import type { RealtimeChannel } from "@supabase/supabase-js";

// Only refetch queries the user is currently looking at — avoids a full-cache
// invalidation that caused a global loading flash on every Realtime reconnect.
const CRITICAL_KEYS: ReadonlyArray<string> = [
  "lessons",
  "homework",
  "todos",
  "students",
  "learning-map",
  "bookings",
  "approvals-bookings",
  "approvals-registrations",
  "my-bookings-as-teacher",
  "my-bookings",
  "my-availability",
  "booking-slots",
  "difficulties",
  "learning-resources",
  "reports",
  "ai-feedback",
];

function refetchCriticalActive(qc: QueryClient) {
  for (const key of CRITICAL_KEYS) {
    qc.invalidateQueries({
      queryKey: [key],
      refetchType: "active",
    });
  }
}

/**
 * Subscribe to Supabase Realtime changes on key tables.
 * When any INSERT / UPDATE / DELETE happens, we invalidate the matching
 * React-Query cache so the UI refreshes automatically — no manual refetch.
 */
export function useRealtimeSync() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!user || !token) return;

    // Pass the user's Supabase JWT to Realtime so it subscribes as
    // the authenticated user — RLS policies require auth.uid().
    supabase.realtime.setAuth(token);

    // One channel with multiple table listeners
    const channel = supabase
      .channel("realtime-sync")
      // ─── Lessons ──────────────────────────────────────────────
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lesson_sessions" },
        () => {
          qc.invalidateQueries({ queryKey: ["lessons"] });
          // Creating/deleting a lesson changes the topic's lessons_total /
          // latest_lesson_id / progress on the learning map.
          qc.invalidateQueries({ queryKey: ["learning-map"] });
        }
      )
      // ─── Homework ─────────────────────────────────────────────
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "homework_items" },
        (payload) => {
          qc.invalidateQueries({ queryKey: ["homework"] });
          qc.invalidateQueries({ queryKey: ["lessons"] });
          // Task completion percentages feed topic progress on the map.
          qc.invalidateQueries({ queryKey: ["learning-map"] });
        }
      )
      // ─── Todos ────────────────────────────────────────────────
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "todo_items" },
        () => {
          qc.invalidateQueries({ queryKey: ["todos"] });
          qc.invalidateQueries({ queryKey: ["lessons"] });
          // Task completion percentages feed topic progress on the map.
          qc.invalidateQueries({ queryKey: ["learning-map"] });
        }
      )
      // ─── Students ─────────────────────────────────────────────
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "students" },
        () => {
          qc.invalidateQueries({ queryKey: ["students"] });
        }
      )
      // ─── Profiles ─────────────────────────────────────────────
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => {
          qc.invalidateQueries({ queryKey: ["students"] });
          // A new student registration shows up as a profile row pending
          // approval — surface it in the teacher's approvals list live.
          qc.invalidateQueries({ queryKey: ["approvals-registrations"] });
          // Keep the sidebar approvals badge live across navigations.
          qc.invalidateQueries({ queryKey: ["approvals-count"] });
        }
      )
      // ─── Student AI Profiles ──────────────────────────────────
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "student_ai_profiles" },
        () => {
          qc.invalidateQueries({ queryKey: ["students"] });
        }
      )
      // ─── Difficulty Reports ───────────────────────────────────
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "difficulty_reports" },
        () => {
          qc.invalidateQueries({ queryKey: ["difficulties"] });
          // Student cards show an "unreviewed_difficulties" badge derived
          // from this table — refresh the roster so the count is live.
          qc.invalidateQueries({ queryKey: ["students"] });
        }
      )
      // ─── Teacher Availability ─────────────────────────────────
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "teacher_availability" },
        () => {
          qc.invalidateQueries({ queryKey: ["availability"] });
          qc.invalidateQueries({ queryKey: ["my-availability"] });
          qc.invalidateQueries({ queryKey: ["booking-slots"] });
        }
      )
      // ─── Lesson Bookings ──────────────────────────────────────
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lesson_bookings" },
        () => {
          qc.invalidateQueries({ queryKey: ["bookings"] });
          qc.invalidateQueries({ queryKey: ["approvals-bookings"] });
          qc.invalidateQueries({ queryKey: ["my-bookings-as-teacher"] });
          qc.invalidateQueries({ queryKey: ["my-bookings"] });
          qc.invalidateQueries({ queryKey: ["booking-slots"] });
          // Keep the sidebar approvals badge live across navigations.
          qc.invalidateQueries({ queryKey: ["approvals-count"] });
        }
      )
      // ─── Teacher AI Feedback ──────────────────────────────────
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "teacher_ai_feedback" },
        () => {
          qc.invalidateQueries({ queryKey: ["ai-feedback"] });
        }
      )
      // ─── Student Reports ──────────────────────────────────────
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "student_reports" },
        () => {
          qc.invalidateQueries({ queryKey: ["reports"] });
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // On (re)connect, refetch only the critical active data instead of
          // blowing away the whole cache (which caused a UI-wide loading flash
          // on every reconnect).
          refetchCriticalActive(qc);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(`Realtime ${status.toLowerCase()} — will auto-reconnect`);
        }
      });

    channelRef.current = channel;

    // Also refetch when the tab comes back online, even without Realtime events.
    const handleOnline = () => refetchCriticalActive(qc);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("online", handleOnline);
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [user?.id, token, qc]);
}
