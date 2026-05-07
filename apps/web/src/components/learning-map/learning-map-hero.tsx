"use client";

/**
 * Hero strip for the student's "My learning map" page.
 *
 * Has two faces:
 *  1. With an exam date set on the course — countdown card with days remaining,
 *     mastery percent, and a triage line ("3 topics in danger / 7 mastered").
 *     This is the "real" student face — academic students live around exam dates.
 *  2. Without an exam date — softer welcome with overall progress only. Falls
 *     back here so the map keeps working for teachers who haven't filled the
 *     course details yet.
 *
 * Teacher view of the map skips this entirely (they want data density, not
 * motivation).
 */
import { useT } from "@/i18n";
import { CalendarClock, Target, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { LearningMapTopic } from "@studiq/types";

export function LearningMapHero({
  studentName,
  courseName,
  overallPct,
  examDate,
  topics,
}: {
  studentName?: string | null;
  courseName?: string | null;
  overallPct: number;
  /** ISO timestamp of the course exam, or null if not set. */
  examDate?: string | null;
  /** Top-level topics — used to count "in danger" without re-fetching. */
  topics?: LearningMapTopic[];
}) {
  const t = useT();

  // No exam date → fall back to the lightweight progress hero.
  if (!examDate) {
    return <SoftHero studentName={studentName} overallPct={overallPct} />;
  }

  const exam = new Date(examDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysUntil = Math.ceil((exam.getTime() - today.getTime()) / msPerDay);

  // "In danger" = below 70% mastery AND the deadline is within the relevant
  // window. The window scales with how close the exam is: when there's a
  // month left, only topics with imminent deadlines count; when the exam is
  // next week, every unmastered topic is in danger.
  const dangerCutoff = daysUntil <= 14 ? Infinity : 14;
  const inDanger = (topics ?? []).filter((t) => {
    if (t.locked) return false;
    if (t.stats.pct >= 70) return false;
    const dl = effectiveDeadlineDays(t.effective_deadline);
    return dl !== null && dl <= dangerCutoff;
  }).length;
  const mastered = (topics ?? []).filter(
    (t) => t.stats.status === "mastered"
  ).length;

  const pastExam = daysUntil < 0;
  const dateFormatted = exam.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // Tone of the countdown ribbon. Drives the band color so the urgency
  // is felt before any text is read.
  const tone =
    pastExam
      ? "from-gray-100 to-white border-gray-200"
      : daysUntil <= 7
        ? "from-red-50 to-white border-red-200"
        : daysUntil <= 21
          ? "from-amber-50 to-white border-amber-200"
          : "from-brand-50 via-white to-white border-brand-100";

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${tone} px-5 sm:px-7 py-5 sm:py-6 mb-5`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        {/* Countdown block — biggest piece of UI on the screen, intentional. */}
        <div className="flex-shrink-0 flex flex-col items-start">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase text-gray-500 bg-white/70 backdrop-blur rounded-full px-2 py-0.5 border border-gray-200">
            <CalendarClock size={11} />
            {t("map.heroExamLabel")}
          </span>
          <div className="mt-2 flex items-baseline gap-2 tabular-nums">
            <span
              className={`text-5xl sm:text-6xl font-extrabold leading-none ${
                pastExam
                  ? "text-gray-400"
                  : daysUntil <= 7
                    ? "text-red-600"
                    : daysUntil <= 21
                      ? "text-amber-700"
                      : "text-brand-700"
              }`}
            >
              {pastExam ? "—" : daysUntil}
            </span>
            <span className="text-sm font-semibold text-gray-600">
              {pastExam
                ? t("map.heroExamPassed")
                : daysUntil === 0
                  ? t("map.heroExamToday")
                  : daysUntil === 1
                    ? t("map.heroDay")
                    : t("map.heroDays")}
            </span>
          </div>
          <span className="text-xs text-gray-500 mt-1">{dateFormatted}</span>
        </div>

        {/* Right-hand block — title + course + mastery bar */}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 leading-tight truncate">
            {courseName ?? t("map.myTitle")}
            {studentName ? (
              <span className="text-gray-400 font-normal">
                {" · "}
                {studentName}
              </span>
            ) : null}
          </h1>

          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 h-2 bg-white rounded-full overflow-hidden border border-gray-100">
              <div
                className="h-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all"
                style={{ width: `${overallPct}%` }}
              />
            </div>
            <span className="text-sm font-bold text-brand-700 tabular-nums whitespace-nowrap">
              {overallPct}%
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">{t("map.heroMasteryLabel")}</p>

          {/* Triage line — only render if we have signal. Quiet success when
              everything's mastered, loud warning when topics are in danger. */}
          {(inDanger > 0 || mastered > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              {inDanger > 0 && (
                <span className="inline-flex items-center gap-1.5 text-red-700 font-medium">
                  <AlertTriangle size={12} />
                  {t("map.heroInDanger", { count: inDanger })}
                </span>
              )}
              {mastered > 0 && (
                <span className="inline-flex items-center gap-1.5 text-green-700">
                  <CheckCircle2 size={12} />
                  {t("map.heroMastered", { count: mastered })}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Lightweight hero for courses without an exam date set. Plain, professional,
 *  no decorative illustration. */
function SoftHero({
  studentName,
  overallPct,
}: {
  studentName?: string | null;
  overallPct: number;
}) {
  const t = useT();
  return (
    <div className="rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50 to-white px-5 sm:px-7 py-5 mb-5">
      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase text-brand-700 bg-white/70 backdrop-blur rounded-full px-2.5 py-1 border border-brand-100">
        <Target size={11} />
        {t("map.heroBadge")}
      </span>
      <h1 className="mt-3 text-2xl font-bold text-gray-900 leading-tight">
        {t("map.myTitle")}
        {studentName ? (
          <span className="text-brand-600"> · {studentName}</span>
        ) : null}
      </h1>
      <p className="text-sm text-gray-600 mt-1.5 max-w-md">
        {t("map.mySubtitle")}
      </p>
      <div className="mt-4 flex items-center gap-3 max-w-md">
        <div className="flex-1 h-2 bg-white rounded-full overflow-hidden border border-brand-100">
          <div
            className="h-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all"
            style={{ width: `${overallPct}%` }}
          />
        </div>
        <span className="text-sm font-bold text-brand-700 tabular-nums">
          {overallPct}%
        </span>
      </div>
    </div>
  );
}

/** Days from today to the topic's effective deadline. Negative = past.
 *  Returns null when no deadline is set. */
function effectiveDeadlineDays(deadline: string | null): number | null {
  if (!deadline) return null;
  const target = new Date(deadline + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
}
