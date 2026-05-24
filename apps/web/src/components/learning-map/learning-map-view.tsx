"use client";

import { useMemo, useState } from "react";
import {
  Sparkles,
  Lock,
  LockOpen,
  BookOpen,
  CheckCircle2,
  Clock,
  AlertTriangle,
  TrendingUp,
  ThumbsUp,
  CalendarClock,
} from "lucide-react";
import type {
  LearningMap,
  LearningMapTopic,
  TopicStatus,
} from "@studiq/types";
import { useT } from "@/i18n";

/**
 * Learning Map — light theme matching Studiq system chrome.
 * Horizontal scrollable topic cards with SVG progress rings, click to
 * expand sub-topic panel. One component, two roles (teacher | student).
 *
 * NOTE: All visible text goes through t(). Direction is inherited from
 * <html dir> set in the root layout based on the user's locale, so no
 * hardcoded `dir` attribute here.
 */
export function LearningMapView({
  role,
  map,
  onCreateLesson,
  onOpenLesson,
  onToggleLock,
}: {
  role: "teacher" | "student";
  map: LearningMap;
  onCreateLesson?: (topicId: string) => void;
  /**
   * Open an existing lesson by id. The parent page builds the role-correct
   * URL (teacher vs student) and navigates.
   */
  onOpenLesson?: (lessonId: string) => void;
  /**
   * Teacher-only: toggle the manual lock flag on a topic. The server is
   * source of truth; the parent page handles the mutation + invalidation.
   */
  onToggleLock?: (topicId: string, nextLocked: boolean) => void;
}) {
  const t = useT();
  const topics = map.topics;

  const initialId = useMemo(() => {
    const struggling = topics.find((tp) => tp.stats.status === "struggling");
    if (struggling) return struggling.id;
    const inProg = topics.find((tp) => tp.stats.status === "in_progress");
    return inProg?.id ?? topics[0]?.id ?? null;
  }, [topics]);

  const [activeId, setActiveId] = useState<string | null>(initialId);
  const active = topics.find((tp) => tp.id === activeId) ?? null;

  // Recommendation order — exam-aware. Topics with imminent deadlines and
  // weak mastery jump the queue; only when the schedule is calm do we fall
  // back to the original "weakest topic" heuristic.
  const recommendation = useMemo(() => {
    const open = topics.filter((tp) => !tp.locked);
    const withUrgency = open.map((tp) => ({
      tp,
      days: deadlineDaysUntil(tp.effective_deadline),
    }));

    // 1. Critical: <= 7 days left and below 70% mastery — this is the topic
    //    that will fail the exam.
    const critical = withUrgency
      .filter(
        ({ tp, days }) => days !== null && days >= 0 && days <= 7 && tp.stats.pct < 70
      )
      .sort((a, b) => a.tp.stats.pct - b.tp.stats.pct);
    if (critical[0]) return critical[0].tp;

    // 2. Soon: <= 21 days and not mastered.
    const soon = withUrgency
      .filter(
        ({ tp, days }) =>
          days !== null && days >= 0 && days <= 21 && tp.stats.status !== "mastered"
      )
      .sort((a, b) => {
        // Closer deadline wins; tie-broken by lower mastery.
        if (a.days !== b.days) return (a.days ?? 0) - (b.days ?? 0);
        return a.tp.stats.pct - b.tp.stats.pct;
      });
    if (soon[0]) return soon[0].tp;

    // 3. Fallback: original heuristic — struggling > in_progress > anything.
    const struggling = open.find((tp) => tp.stats.status === "struggling");
    if (struggling) return struggling;
    const inProgress = open
      .filter((tp) => tp.stats.status === "in_progress")
      .sort((a, b) => a.stats.pct - b.stats.pct)[0];
    if (inProgress) return inProgress;
    return open.find((tp) => tp.stats.status === "not_started") ?? open[0] ?? null;
  }, [topics]);

  const counts = map.overall;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex-1 min-h-0 flex flex-col">
      {/* TOPBAR — role/title + big stat cards in a single horizontally-flowing
          band so the student gets the full picture at a glance instead of
          tiny labels squeezed into the chrome. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3 px-4 sm:px-5 py-3 border-b border-gray-100 bg-gray-50/60">
        <span className="inline-flex items-center text-[10px] font-bold tracking-wider uppercase text-gray-500 border border-gray-200 rounded px-2 py-0.5">
          {role === "teacher" ? t("map.roleTeacher") : t("map.roleStudent")}
        </span>
        <span className="text-sm font-semibold text-gray-900">
          {t("map.title")}
        </span>
        <span className="w-px h-4 bg-gray-200 hidden sm:inline-block" />
        <span className="text-xs text-gray-500 font-medium truncate max-w-[16rem]">
          {map.course_name}
        </span>
        <div className="flex-1" />
        <div className="flex items-center flex-wrap gap-2 w-full sm:w-auto">
          <Stat
            icon={BookOpen}
            label={t("map.statTotal")}
            value={counts.total_topics}
            iconBg="bg-brand-50"
            iconColor="text-brand-600"
          />
          <Stat
            icon={CheckCircle2}
            label={t("map.statMastered")}
            value={counts.mastered}
            iconBg="bg-green-50"
            iconColor="text-green-600"
            valueColor="text-green-600"
          />
          <Stat
            icon={Clock}
            label={t("map.statInProgress")}
            value={counts.in_progress}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
            valueColor="text-amber-600"
          />
          <Stat
            icon={AlertTriangle}
            label={t("map.statStruggling")}
            value={counts.struggling}
            iconBg="bg-red-50"
            iconColor="text-red-600"
            valueColor={
              counts.struggling > 0 ? "text-red-600" : "text-gray-900"
            }
          />
          <Stat
            icon={TrendingUp}
            label={t("map.statOverall")}
            value={`${counts.overall_pct}%`}
            iconBg="bg-gray-100"
            iconColor="text-gray-600"
          />
        </div>
      </div>

      <div className="flex flex-col lg:flex-row flex-1 min-h-0">
        {/* SIDE PANEL */}
        <aside className="w-full lg:w-56 lg:flex-shrink-0 order-2 lg:order-none border-t lg:border-t-0 lg:border-s border-gray-100 flex flex-col p-3 gap-3">
          {/* AI recommendation panel — hidden when the teacher is already
              focused on the recommended topic, since the active card has its
              own big "create lesson" CTA in that case. Showing both creates
              two identical buttons in the same eyeline. When the teacher
              navigates to a different topic, the panel reappears as a
              "you should look at this instead" nudge — which is when the
              recommendation is actually useful. */}
          {role === "teacher" && recommendation && activeId !== recommendation.id && (
            <button
              onClick={() => setActiveId(recommendation.id)}
              className="bg-brand-50/60 border border-brand-100 rounded-lg p-3 flex flex-col gap-2 text-start hover:bg-brand-50 hover:border-brand-200 transition-colors group"
              title={t("map.aiRecommendation")}
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-white border border-brand-100 flex items-center justify-center">
                  <Sparkles size={12} className="text-brand-600" />
                </div>
                <span className="text-[10px] font-bold tracking-wider uppercase text-brand-700">
                  {t("map.aiRecommendation")}
                </span>
              </div>
              <div className="text-[13px] font-semibold text-gray-900 leading-tight line-clamp-2 group-hover:text-brand-700 transition-colors">
                {recommendation.name}
              </div>
              <div className="text-[10px] text-gray-500">
                {t(`map.recReason.${recReasonKey(recommendation.stats.status)}`)}
                {recommendation.stats.tasks_failed > 0 &&
                  ` · ${t("map.failuresCount", {
                    count: recommendation.stats.tasks_failed,
                  })}`}
              </div>
            </button>
          )}

          {role === "student" && (
            <div className="bg-white border border-gray-100 rounded-lg p-3.5 flex flex-col gap-3 shadow-sm">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <ThumbsUp size={14} className="text-amber-500" />
                </div>
                <span className="text-[12px] font-semibold text-gray-900">
                  {t("map.overallProgress")}
                </span>
              </div>

              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900 tabular-nums leading-none">
                  {counts.overall_pct}%
                </div>
              </div>

              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden relative">
                <div
                  className="absolute end-0 top-0 bottom-0 bg-gradient-to-l from-green-400 to-green-500 rounded-full transition-all"
                  style={{ width: `${counts.overall_pct}%` }}
                />
              </div>

              <div className="text-[10px] text-gray-400 text-end">
                {t("map.keepGoing")}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
                <div className="flex flex-col items-start">
                  <span className="text-[10px] text-gray-500">
                    {t("map.statMastered")}
                  </span>
                  <span className="text-base font-bold text-gray-900 tabular-nums">
                    {counts.mastered}
                  </span>
                </div>
                <div className="flex flex-col items-start">
                  <span className="text-[10px] text-gray-500">
                    {t("map.statInProgress")}
                  </span>
                  <span className="text-base font-bold text-amber-600 tabular-nums">
                    {counts.in_progress}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="text-[10px] font-bold tracking-wider uppercase text-gray-400 px-1 pt-1">
            {t("map.allTopics")}
          </div>
          <div className="flex flex-col gap-0.5">
            {topics.map((tp) => (
              <button
                key={tp.id}
                onClick={() => !tp.locked && setActiveId(tp.id)}
                disabled={tp.locked}
                className={`flex items-center gap-2 h-8 px-2 rounded-md text-start w-full transition-colors ${
                  tp.locked
                    ? "opacity-40 cursor-default"
                    : activeId === tp.id
                    ? "bg-gray-100"
                    : "hover:bg-gray-50"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotBg(
                    tp.stats.status
                  )}`}
                />
                <span
                  className={`text-[11px] flex-1 truncate ${
                    activeId === tp.id
                      ? "text-gray-900 font-semibold"
                      : "text-gray-600"
                  }`}
                >
                  {tp.name}
                </span>
                {tp.locked ? (
                  <Lock size={11} className="text-gray-400 flex-shrink-0" />
                ) : (
                  <span
                    className={`text-[11px] font-bold tabular-nums ${statusText(
                      tp.stats.status
                    )}`}
                  >
                    {tp.stats.pct}%
                  </span>
                )}
              </button>
            ))}
          </div>
        </aside>

        {/* MAIN */}
        <main className="flex-1 flex flex-col min-w-0 order-1 lg:order-none">
          {/* Card row */}
          <div className="px-4 sm:px-5 pt-4 overflow-x-auto">
            <div
              className="flex gap-3 pb-4"
              style={{ width: "max-content" }}
            >
              {topics.map((tp) => (
                <TopicCard
                  key={tp.id}
                  topic={tp}
                  active={activeId === tp.id}
                  role={role}
                  onClick={() => !tp.locked && setActiveId(tp.id)}
                  onCreateLesson={onCreateLesson}
                  onOpenLesson={onOpenLesson}
                  onToggleLock={onToggleLock}
                />
              ))}
              {topics.length === 0 && (
                <div className="text-gray-400 text-sm p-6">
                  {t("map.noTopics")}
                </div>
              )}
            </div>
          </div>

          {/* Detail panel */}
          {active && (
            <div className="mx-4 sm:mx-5 mb-5 border border-gray-100 rounded-lg bg-gray-50/40 overflow-hidden flex-1 min-h-0 flex flex-col">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white">
                <span className="text-sm font-semibold text-gray-900 flex-1 truncate">
                  {active.name}
                </span>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider ${statusText(
                    active.stats.status
                  )}`}
                >
                  {statusLabel(t, active.stats.status, role)}
                </span>
                {/* The lesson action lives on the active topic card (single
                    primary CTA). The duplicate "create lesson on this topic"
                    button that used to sit here was removed to avoid three
                    competing lesson buttons per topic. */}
              </div>

              {/* Stat grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-x-reverse divide-gray-100 border-b border-gray-100">
                <KpiCell
                  label={t("map.kpiProgress")}
                  value={`${active.stats.pct}%`}
                  tone={active.stats.status}
                />
                <KpiCell
                  label={t("map.kpiLessons")}
                  value={active.stats.lessons_total}
                />
                <KpiCell
                  label={t("map.kpiTasks")}
                  value={t("map.tasksFraction", {
                    done: active.stats.tasks_completed,
                    total: active.stats.tasks_total,
                  })}
                />
                <KpiCell
                  label={t("map.kpiStruggling")}
                  value={active.stats.tasks_failed}
                  tone={
                    active.stats.tasks_failed > 0
                      ? "struggling"
                      : "not_started"
                  }
                />
              </div>

              {active.children.length > 0 ? (
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {active.children.map((c) => (
                    <SubtopicRow key={c.id} topic={c} role={role} />
                  ))}
                </div>
              ) : (
                <div className="flex-1 min-h-0 px-4 py-5 text-[12px] text-gray-400 text-center flex items-center justify-center">
                  {active.stats.lessons_total === 0
                    ? role === "teacher"
                      ? t("map.noLessonsTeacher")
                      : t("map.notStartedStudent")
                    : t("map.noSubtopics")}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Stat({
  icon: Icon,
  label,
  value,
  iconBg,
  iconColor,
  valueColor,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string | number;
  iconBg: string;
  iconColor: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-100 px-2.5 py-1.5">
      <div className="flex flex-col items-end min-w-0">
        <span
          className={`text-base font-bold tabular-nums leading-tight ${
            valueColor ?? "text-gray-900"
          }`}
        >
          {value}
        </span>
        <span className="text-[10px] text-gray-500 leading-tight whitespace-nowrap">
          {label}
        </span>
      </div>
      <div
        className={`flex items-center justify-center w-7 h-7 rounded-full ${iconBg}`}
      >
        <Icon size={14} className={iconColor} />
      </div>
    </div>
  );
}

function KpiCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: TopicStatus;
}) {
  const color = tone ? statusText(tone) : "text-gray-900";
  return (
    <div className="px-4 py-3 flex flex-col gap-0.5">
      <span className="text-[10px] font-bold tracking-wider uppercase text-gray-400">
        {label}
      </span>
      <span className={`text-base font-bold tabular-nums ${color}`}>
        {value}
      </span>
    </div>
  );
}

function TopicCard({
  topic: tp,
  active,
  role,
  onClick,
  onCreateLesson,
  onOpenLesson,
  onToggleLock,
}: {
  topic: LearningMapTopic;
  active: boolean;
  role: "teacher" | "student";
  onClick: () => void;
  onCreateLesson?: (id: string) => void;
  onOpenLesson?: (lessonId: string) => void;
  onToggleLock?: (id: string, nextLocked: boolean) => void;
}) {
  const t = useT();
  const status = tp.stats.status;
  const pct = tp.stats.pct;
  // A topic "has a lesson" only when the API gave us an id to open. This
  // single flag drives the one primary action: open it vs. create one.
  const hasLesson = tp.stats.lessons_total > 0 && !!tp.latest_lesson_id;
  // Big CTA on the currently-selected, unlocked card — both roles get one,
  // with the label switched: teachers see "create lesson", students see
  // "start/continue learning". Removes the need to hunt for a small button.
  const showCta = active && !tp.locked;
  // Slightly taller card when CTA is showing so the button has room.
  const cardHeight = showCta ? "h-[200px]" : "h-[172px]";

  // ── Locked state ── render a clearly-disabled card with a prominent
  // lock badge instead of just dimming opacity. Communicates "blocked" at
  // a glance (matches the reference design).
  if (tp.locked) {
    // Teachers see an unlock button at the foot of the card (replacing
    // the stats line); students see only the stats line and no button.
    // Card height stays at 172px in both cases — the contents are
    // tightened so nothing overflows.
    const showUnlockButton = role === "teacher" && !!onToggleLock;
    return (
      <div className="relative w-[196px] h-[172px] flex-shrink-0 bg-gray-50 rounded-lg border border-gray-200 p-3 flex flex-col cursor-not-allowed select-none overflow-hidden">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] font-bold tracking-wider uppercase text-gray-400">
            {statusLabel(t, status, role)}
          </span>
          <span className="text-[9px] text-gray-400">
            {t("map.lessonsCount", { count: tp.stats.lessons_total })}
          </span>
        </div>

        <div className="flex flex-col items-center justify-center flex-1 text-center gap-1.5 min-h-0">
          <div className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center shadow-sm flex-shrink-0">
            <Lock size={14} className="text-gray-400" />
          </div>
          <div className="text-[12px] font-semibold text-gray-500 leading-tight line-clamp-2 px-0.5">
            {tp.name}
          </div>
          {!showUnlockButton && (
            <div className="text-[9px] text-gray-400 leading-snug px-0.5 line-clamp-2">
              {t("map.lockedHint")}
            </div>
          )}
        </div>

        {showUnlockButton ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleLock?.(tp.id, false);
            }}
            className="mt-1.5 w-full h-7 rounded-md bg-white border border-gray-300 hover:border-brand-300 hover:bg-brand-50 text-gray-700 hover:text-brand-700 text-[11px] font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer flex-shrink-0"
          >
            <LockOpen size={12} />
            {t("map.unlockTopic")}
          </button>
        ) : (
          <div className="flex items-center justify-between pt-1.5 border-t border-gray-200/70 flex-shrink-0">
            <span className="text-[10px] text-gray-400 tabular-nums">
              {t("map.tasksFraction", {
                done: tp.stats.tasks_completed,
                total: tp.stats.tasks_total,
              })}
            </span>
            <span className="text-[10px] font-semibold text-gray-400">
              {t("map.notStartedShort")}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`relative w-[196px] ${cardHeight} flex-shrink-0 bg-white rounded-lg border p-4 flex flex-col cursor-pointer transition-all ${
        active
          ? "border-brand-300 shadow-md ring-1 ring-brand-100"
          : "border-gray-100 hover:border-gray-200 hover:shadow-sm"
      }`}
    >
      {/* stripe */}
      <div
        className={`absolute start-0 top-3 bottom-3 w-[3px] rounded-e ${stripeBg(
          status
        )}`}
      />

      <div className="flex items-center justify-between mb-2 gap-1">
        <span
          className={`text-[9px] font-bold tracking-wider uppercase ${statusText(
            status
          )}`}
        >
          {statusLabel(t, status, role)}
        </span>
        <DeadlineBadge deadline={tp.effective_deadline} pct={tp.stats.pct} />
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-gray-400">
            {t("map.lessonsCount", { count: tp.stats.lessons_total })}
          </span>
          {role === "teacher" && onToggleLock && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleLock(tp.id, true);
              }}
              title={t("map.lockTopic")}
              aria-label={t("map.lockTopic")}
              className="text-gray-300 hover:text-gray-600 transition-colors p-0.5 -m-0.5 cursor-pointer"
            >
              <LockOpen size={11} />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-1 min-h-0">
        <div className="flex-1 min-w-0">
          <div
            className={`text-sm font-bold leading-tight line-clamp-3 ${
              status === "not_started"
                ? "text-gray-400"
                : status === "struggling"
                ? "text-red-600"
                : "text-gray-900"
            }`}
          >
            {tp.name}
          </div>
          <div className="text-[9px] text-gray-400 mt-1">
            {tp.children.length > 0
              ? t("map.subtopicsCount", { count: tp.children.length })
              : t("map.standalone")}
          </div>
        </div>
        <ProgressRing pct={pct} status={status} />
      </div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
        {tp.stats.tasks_failed > 0 ? (
          <span className="text-[10px] text-red-600 font-medium">
            {t("map.failuresCount", { count: tp.stats.tasks_failed })}
          </span>
        ) : (
          <span className="text-[10px] text-gray-400 tabular-nums">
            {t("map.tasksFraction", {
              done: tp.stats.tasks_completed,
              total: tp.stats.tasks_total,
            })}
          </span>
        )}
        {/* Teachers no longer get a footer "Lesson" button — the single
            primary action (create/open) is the CTA on the active card.
            Students keep a lightweight status hint here. */}
        {role === "student" && (
          <span
            className={`text-[10px] font-semibold ${statusText(status)}`}
          >
            {pct === 100
              ? "✓"
              : status === "not_started"
              ? t("map.notStartedShort")
              : t("map.continue")}
          </span>
        )}
      </div>

      {/* Single primary action on the active card. One topic → one button:
          • has a lesson  → "Open lesson" (navigate to latest_lesson_id)
          • no lesson yet → teacher creates one; student starts/continues. */}
      {showCta &&
        (hasLesson ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenLesson?.(tp.latest_lesson_id!);
            }}
            className="mt-2 w-full h-8 rounded-md bg-brand-500 hover:bg-brand-600 text-white text-[12px] font-semibold transition-colors shadow-sm"
          >
            {t("map.openLesson")}
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCreateLesson?.(tp.id);
            }}
            className="mt-2 w-full h-8 rounded-md bg-brand-500 hover:bg-brand-600 text-white text-[12px] font-semibold transition-colors shadow-sm"
          >
            {role === "teacher"
              ? t("map.createLesson")
              : status === "not_started"
              ? t("map.startLearning")
              : t("map.continueLearning")}
          </button>
        ))}
    </div>
  );
}

function ProgressRing({
  pct,
  status,
}: {
  pct: number;
  status: TopicStatus;
}) {
  const r = 19;
  const cx = 23;
  const cy = 23;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const stroke = ringStroke(status);
  return (
    <div className="relative flex-shrink-0">
      <svg width={46} height={46} className="block">
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#F3F4F6"
          strokeWidth={3.5}
        />
        {pct > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        )}
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums ${statusText(
          status
        )}`}
      >
        {pct}%
      </span>
    </div>
  );
}

function SubtopicRow({
  topic: tp,
  role,
}: {
  topic: LearningMapTopic;
  role: "teacher" | "student";
}) {
  const t = useT();
  const status = tp.stats.status;
  return (
    <div className="flex items-center h-10 px-4 gap-3 border-b border-gray-100 last:border-b-0 hover:bg-white transition-colors">
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotBg(status)}`}
      />
      <span
        className={`text-xs flex-1 truncate ${
          status === "struggling"
            ? "text-red-600"
            : status === "not_started"
            ? "text-gray-400"
            : "text-gray-900"
        }`}
      >
        {tp.name}
      </span>
      <div className="flex items-center gap-2">
        <div className="w-16 h-1 bg-gray-200 rounded-full overflow-hidden relative">
          <div
            className={`absolute end-0 top-0 bottom-0 rounded-full ${barBg(
              status
            )}`}
            style={{ width: `${tp.stats.pct}%` }}
          />
        </div>
        <span className="text-[11px] font-bold tabular-nums w-7 text-start text-gray-600">
          {tp.stats.pct}%
        </span>
      </div>
      <span
        className={`text-[9px] font-semibold w-14 text-center uppercase tracking-wider ${statusText(
          status
        )}`}
      >
        {statusLabel(t, status, role)}
      </span>
    </div>
  );
}

// ─── Color + label helpers ────────────────────────────────────────────────

/** Map a status + role into the right translation key. */
function statusLabel(
  t: ReturnType<typeof useT>,
  s: TopicStatus,
  role: "teacher" | "student"
): string {
  const suffix = role === "teacher" ? "Teacher" : "Student";
  const base =
    s === "mastered"
      ? "statusMastered"
      : s === "in_progress"
      ? "statusInProgress"
      : s === "struggling"
      ? "statusStruggling"
      : "statusNotStarted";
  return t(`map.${base}${suffix}`);
}

function recReasonKey(s: TopicStatus): string {
  if (s === "struggling") return "struggling";
  if (s === "in_progress") return "in_progress";
  if (s === "not_started") return "not_started";
  return "default";
}

function statusText(s: TopicStatus): string {
  switch (s) {
    case "mastered":
      return "text-green-600";
    case "in_progress":
      return "text-amber-600";
    case "struggling":
      return "text-red-600";
    default:
      return "text-gray-400";
  }
}

function stripeBg(s: TopicStatus): string {
  switch (s) {
    case "mastered":
      return "bg-green-500";
    case "in_progress":
      return "bg-amber-500";
    case "struggling":
      return "bg-red-500";
    default:
      // Soft brand accent so not-started cards still feel inviting,
      // matching the recolored progress ring.
      return "bg-brand-200";
  }
}

function dotBg(s: TopicStatus): string {
  switch (s) {
    case "mastered":
      return "bg-green-500";
    case "in_progress":
      return "bg-amber-500";
    case "struggling":
      return "bg-red-500";
    default:
      return "bg-gray-300";
  }
}

function barBg(s: TopicStatus): string {
  switch (s) {
    case "mastered":
      return "bg-green-500";
    case "in_progress":
      return "bg-amber-500";
    case "struggling":
      return "bg-red-500";
    default:
      return "bg-gray-300";
  }
}

// ─── Deadline helpers ─────────────────────────────────────────────────────

/** Days from today (00:00 local) to deadline. Negative = past. Null = no
 *  deadline set on the topic or course. */
function deadlineDaysUntil(deadline: string | null): number | null {
  if (!deadline) return null;
  const target = new Date(deadline + "T00:00:00");
  if (isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
}

/** Small pill on a topic card surfacing imminent deadlines. Quiet by
 *  default — only renders inside the danger window or when overdue while
 *  the topic isn't mastered yet. */
function DeadlineBadge({
  deadline,
  pct,
}: {
  deadline: string | null;
  pct: number;
}) {
  const t = useT();
  const days = deadlineDaysUntil(deadline);
  if (days === null) return null;
  // Once the student is at 100% the topic is done — the deadline doesn't
  // need to scream at them anymore.
  if (pct >= 100) return null;
  // Render only when within the meaningful window. Far-future deadlines
  // would just clutter the cards.
  if (days > 21 && days >= 0) return null;

  const overdue = days < 0;
  const tone = overdue
    ? "bg-red-100 text-red-700 border-red-200"
    : days <= 7
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-amber-50 text-amber-700 border-amber-200";

  const label = overdue
    ? t("map.deadlineOverdue")
    : days === 0
      ? t("map.deadlineToday")
      : t("map.deadlineDays", { count: days });

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[9px] font-bold tabular-nums border rounded px-1.5 py-0.5 ${tone}`}
    >
      <CalendarClock size={9} />
      {label}
    </span>
  );
}

function ringStroke(s: TopicStatus): string {
  switch (s) {
    case "mastered":
      return "#16A34A";
    case "in_progress":
      return "#D97706";
    case "struggling":
      return "#DC2626";
    default:
      // Brand sky-blue instead of dead gray — signals "ready to start"
      // rather than "disabled".
      return "#0EA5E9";
  }
}
