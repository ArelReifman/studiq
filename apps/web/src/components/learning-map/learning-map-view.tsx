"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Flame, Sparkles, Lock } from "lucide-react";
import type {
  LearningMap,
  LearningMapTopic,
  TopicStatus,
} from "@studiq/types";

/**
 * Learning Map — dark, Linear-style view.
 * Horizontal scrollable topic cards with SVG progress rings, click to
 * expand sub-topic panel. One component, two roles (teacher | student).
 */
export function LearningMapView({
  role,
  map,
  onCreateLesson,
}: {
  role: "teacher" | "student";
  map: LearningMap;
  /** Teacher-only: wire to lesson creation flow */
  onCreateLesson?: (topicId: string) => void;
}) {
  const topics = map.topics;

  // Pick initial active card: first in_progress, else first not_started, else first
  const initialId = useMemo(() => {
    const inProg = topics.find((t) => t.stats.status === "in_progress");
    const notStarted = topics.find((t) => t.stats.status === "not_started");
    return inProg?.id ?? notStarted?.id ?? topics[0]?.id ?? null;
  }, [topics]);

  const [activeId, setActiveId] = useState<string | null>(initialId);
  const active = topics.find((t) => t.id === activeId) ?? null;

  // AI recommendation: lowest pct non-locked topic with failures, else first struggling
  const recommendation = useMemo(() => {
    const struggling = topics.find(
      (t) => t.stats.status === "struggling" && !t.locked
    );
    if (struggling) return struggling;
    const inProgress = topics
      .filter((t) => t.stats.status === "in_progress" && !t.locked)
      .sort((a, b) => a.stats.pct - b.stats.pct)[0];
    return inProgress ?? null;
  }, [topics]);

  const counts = map.overall;

  return (
    <div
      dir="rtl"
      className="flex flex-col bg-[#09090B] text-white/90 font-[Heebo,sans-serif] rounded-xl border border-white/[0.07] overflow-hidden"
      style={{ minHeight: 620 }}
    >
      {/* TOPBAR */}
      <div className="flex items-center h-[50px] px-5 border-b border-white/[0.07] bg-[rgba(9,9,11,.96)] backdrop-blur flex-shrink-0">
        <span className="text-[9px] font-bold tracking-[0.1em] uppercase text-white/[0.22] border border-white/[0.12] rounded px-[7px] py-[2px] ms-[10px]">
          {role === "teacher" ? "מורה" : "תלמיד"}
        </span>
        <span className="text-[13px] font-bold tracking-[-0.2px]">
          מפת למידה
        </span>
        <span className="w-px h-[18px] bg-white/[0.07] mx-3" />
        <span className="text-[11px] text-white/[0.22] font-medium">
          {map.course_name}
        </span>
        <div className="flex-1" />
        <div className="flex items-center">
          <Stat label="סה״כ" value={counts.total_topics} />
          <Stat label="שלטו" value={counts.mastered} tone="g" />
          <Stat label="בתהליך" value={counts.in_progress} tone="a" />
          <Stat label="נכשלו" value={counts.struggling} tone="r" />
          <Stat label="כולל" value={`${counts.overall_pct}%`} />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-[520px]">
        {/* SIDE PANEL */}
        <aside className="w-[220px] flex-shrink-0 border-s border-white/[0.07] flex flex-col p-4 gap-3 overflow-y-auto">
          {role === "teacher" && recommendation && (
            <div className="bg-[#111113] border border-white/[0.07] rounded-[10px] p-3 flex flex-col gap-2">
              <div className="w-[26px] h-[26px] rounded-[5px] bg-[rgba(96,165,250,0.1)] border border-[rgba(96,165,250,0.16)] flex items-center justify-center">
                <Sparkles size={12} className="text-[#60A5FA]" />
              </div>
              <div className="text-[8px] font-bold tracking-[0.08em] uppercase text-white/[0.22]">
                המלצת AI
              </div>
              <div className="text-[12px] font-bold leading-tight">
                חיזוק ב{recommendation.name}
              </div>
              <div className="text-[9px] text-white/[0.5]">
                {recommendation.stats.tasks_failed} כישלונות ·{" "}
                {recommendation.stats.pct}% התקדמות
              </div>
              <button
                onClick={() => onCreateLesson?.(recommendation.id)}
                className="h-[28px] rounded-[5px] bg-[#18181C] border border-white/[0.12] text-[10px] font-semibold hover:bg-[#1E1E24] hover:border-white/[0.2] transition-colors"
              >
                צור שיעור
              </button>
            </div>
          )}

          {role === "student" && (
            <div className="bg-[#111113] border border-white/[0.07] rounded-[10px] p-3 flex flex-col gap-[6px]">
              <div className="flex items-center gap-2">
                <Flame size={18} className="text-[#FBBF24]" />
                <div>
                  <div className="text-[12px] font-bold">
                    {counts.overall_pct}% מהמסלול
                  </div>
                  <div className="text-[9px] text-white/[0.5]">
                    המשך ככה
                  </div>
                </div>
              </div>
              <div className="h-[2px] bg-white/[0.12] rounded-[1px] overflow-hidden relative">
                <div
                  className="absolute right-0 top-0 bottom-0 bg-[#34D399] rounded-[1px]"
                  style={{ width: `${counts.overall_pct}%` }}
                />
              </div>
              <div className="flex justify-between text-[9px] text-white/[0.22]">
                <span>{counts.mastered} שלטת</span>
                <span>{counts.in_progress} בתהליך</span>
              </div>
            </div>
          )}

          <div className="h-px bg-white/[0.07] my-[2px]" />
          <div className="text-[9px] font-bold tracking-[0.1em] uppercase text-white/[0.22]">
            כל הנושאים
          </div>
          {topics.map((t) => (
            <button
              key={t.id}
              onClick={() => !t.locked && setActiveId(t.id)}
              disabled={t.locked}
              className={`flex items-center gap-2 h-8 px-[6px] rounded-md transition-colors text-start w-full ${
                t.locked ? "opacity-40 cursor-default" : "hover:bg-white/[0.08]"
              }`}
            >
              <span
                className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${dotColor(
                  t.stats.status
                )}`}
              />
              <span
                className={`text-[11px] flex-1 truncate ${
                  activeId === t.id
                    ? "text-white font-semibold"
                    : "text-white/[0.5]"
                }`}
              >
                {t.name}
              </span>
              <span
                className={`text-[10px] font-bold tabular-nums ${statusTextColor(
                  t.stats.status
                )}`}
              >
                {t.stats.pct}%
              </span>
            </button>
          ))}
        </aside>

        {/* MAIN */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Card row */}
          <div className="flex-shrink-0 px-[18px] pt-4 overflow-x-auto">
            <div
              className="flex gap-[9px] pb-4"
              style={{ width: "max-content" }}
            >
              {topics.map((t) => (
                <TopicCard
                  key={t.id}
                  topic={t}
                  active={activeId === t.id}
                  role={role}
                  onClick={() => !t.locked && setActiveId(t.id)}
                  onCreateLesson={onCreateLesson}
                />
              ))}
              {topics.length === 0 && (
                <div className="text-white/[0.5] text-[12px] p-6">
                  אין נושאים במסלול הזה עדיין
                </div>
              )}
            </div>
          </div>

          {/* Expanded panel */}
          {active && active.children.length > 0 && (
            <div className="flex-1 mx-[18px] mb-4 border border-white/[0.12] rounded-[10px] bg-[#111113] overflow-y-auto">
              <div className="flex items-center gap-[10px] px-[14px] py-[10px] border-b border-white/[0.07] sticky top-0 bg-[#111113] z-10">
                <span className="text-[12px] font-bold flex-1">
                  {active.name}
                </span>
                <span className="text-[9px] text-white/[0.22]">
                  {active.children.length} תת-נושאים
                </span>
                {role === "teacher" && (
                  <button
                    onClick={() => onCreateLesson?.(active.id)}
                    className="text-[9px] font-semibold px-[10px] py-1 rounded-[5px] border border-[rgba(96,165,250,0.2)] bg-[rgba(96,165,250,0.06)] text-[#60A5FA] hover:border-[rgba(96,165,250,0.4)] transition-colors"
                  >
                    צור שיעור בנושא זה
                  </button>
                )}
              </div>
              {active.children.map((c) => (
                <SubtopicRow key={c.id} topic={c} role={role} />
              ))}
            </div>
          )}

          {active && active.children.length === 0 && (
            <div className="flex-1 mx-[18px] mb-4 border border-white/[0.12] rounded-[10px] bg-[#111113] p-6 text-[12px] text-white/[0.5] text-center">
              אין עדיין תת-נושאים ל{active.name}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "g" | "a" | "r";
}) {
  const color =
    tone === "g"
      ? "text-[#34D399]"
      : tone === "a"
      ? "text-[#FBBF24]"
      : tone === "r"
      ? "text-[#F87171]"
      : "text-white/90";
  return (
    <div className="flex items-baseline gap-[3px] px-[10px] border-s border-white/[0.07] first:border-s-0">
      <span
        className={`text-[14px] font-extrabold tracking-[-0.4px] tabular-nums ${color}`}
      >
        {value}
      </span>
      <span className="text-[9px] text-white/[0.22]">{label}</span>
    </div>
  );
}

function TopicCard({
  topic: t,
  active,
  role,
  onClick,
  onCreateLesson,
}: {
  topic: LearningMapTopic;
  active: boolean;
  role: "teacher" | "student";
  onClick: () => void;
  onCreateLesson?: (id: string) => void;
}) {
  const status = t.stats.status;
  const stripe = stripeColor(status);
  const ringColor = ringStrokeColor(status);
  const pct = t.stats.pct;

  return (
    <div
      onClick={onClick}
      className={`relative w-[188px] h-[168px] flex-shrink-0 bg-[#111113] rounded-[10px] border flex flex-col p-[18px] overflow-hidden transition-colors cursor-pointer ${
        active
          ? "border-white/[0.22] bg-[#18181C] shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
          : "border-white/[0.07] hover:border-white/[0.12]"
      } ${t.locked ? "opacity-40 cursor-not-allowed" : ""}`}
    >
      {/* stripe */}
      <div
        className="absolute start-0 top-2 bottom-2 w-[2.5px] rounded-s-none rounded-e-[2px]"
        style={{ background: stripe }}
      />

      <div className="flex items-center justify-between mb-2">
        <span
          className={`text-[8px] font-bold tracking-[0.07em] uppercase ${statusTextColor(
            status
          )}`}
        >
          {statusLabel(status, role)}
        </span>
        {t.locked ? (
          <Lock size={10} className="text-white/[0.22]" />
        ) : (
          <span className="text-[8px] text-white/[0.22] font-medium">
            {t.stats.lessons_total} שיעורים
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-1">
        <div className="flex-1 min-w-0">
          <div
            className={`text-[15px] font-extrabold tracking-[-0.4px] leading-tight ${
              status === "not_started"
                ? "text-white/[0.22]"
                : status === "struggling"
                ? "text-[rgba(248,113,113,0.85)]"
                : "text-white/90"
            }`}
          >
            {t.name}
          </div>
          <div className="text-[9px] text-white/[0.22] mt-1">
            {t.children.length > 0
              ? `${t.children.length} תת-נושאים`
              : "נושא עצמאי"}
          </div>
        </div>
        <ProgressRing pct={pct} color={ringColor} status={status} />
      </div>

      <div className="flex items-center justify-between mt-2 pt-[7px] border-t border-white/[0.07]">
        {t.stats.tasks_failed > 0 ? (
          <span className="flex items-center gap-[3px] text-[9px] text-[#F87171]">
            <b className="text-[10px] font-bold tabular-nums">
              {t.stats.tasks_failed}
            </b>
            קשיים
          </span>
        ) : (
          <span className="flex items-center gap-[3px] text-[9px] text-white/[0.22]">
            <b className="text-[10px] font-bold tabular-nums text-white/[0.5]">
              {t.stats.tasks_completed}
            </b>
            /{t.stats.tasks_total}
          </span>
        )}
        {role === "teacher" && !t.locked ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCreateLesson?.(t.id);
            }}
            className={`text-[9px] font-semibold px-2 py-[3px] rounded-[4px] border whitespace-nowrap transition-colors ${
              status === "struggling"
                ? "bg-[rgba(96,165,250,0.1)] border-[rgba(96,165,250,0.2)] text-[#60A5FA]"
                : "bg-[#1E1E24] border-white/[0.12] text-white/[0.5] hover:text-white hover:border-white/[0.22]"
            }`}
          >
            שיעור
          </button>
        ) : (
          <span className="text-[9px] font-semibold text-white/[0.22]">
            {pct === 100 ? "✓" : status === "not_started" ? "טרם" : "המשך"}
          </span>
        )}
      </div>

      {active && (
        <span
          className="absolute bottom-[-17px] right-1/2 translate-x-1/2 w-px h-[17px] bg-white/[0.12]"
          aria-hidden
        />
      )}
    </div>
  );
}

function ProgressRing({
  pct,
  color,
  status,
}: {
  pct: number;
  color: string;
  status: TopicStatus;
}) {
  const r = 18;
  const cx = 22;
  const cy = 22;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const textColor = statusTextColor(status);
  return (
    <div className="relative flex-shrink-0">
      <svg width={44} height={44} className="block overflow-visible">
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={3.5}
        />
        {pct > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        )}
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center text-[10px] font-extrabold tabular-nums tracking-[-0.5px] ${textColor}`}
      >
        {pct}%
      </span>
    </div>
  );
}

function SubtopicRow({
  topic: t,
  role,
}: {
  topic: LearningMapTopic;
  role: "teacher" | "student";
}) {
  const status = t.stats.status;
  return (
    <div className="flex items-center h-[38px] px-[14px] gap-[10px] border-b border-white/[0.07] last:border-b-0 hover:bg-white/[0.013]">
      <span
        className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${dotColor(
          status
        )}`}
      />
      <span
        className={`text-[11px] flex-1 truncate ${
          status === "mastered"
            ? "text-white/90 font-medium"
            : status === "struggling"
            ? "text-[rgba(248,113,113,0.8)]"
            : status === "not_started"
            ? "text-white/[0.22]"
            : "text-white/90"
        }`}
      >
        {t.name}
      </span>
      <div className="flex items-center gap-[7px]">
        <div className="w-[72px] h-[2px] bg-white/[0.12] rounded-[1px] overflow-hidden relative">
          <div
            className={`absolute right-0 top-0 bottom-0 rounded-[1px] ${barFillColor(
              status
            )}`}
            style={{ width: `${t.stats.pct}%` }}
          />
        </div>
        <span className="text-[10px] font-bold tabular-nums w-7 text-start text-white/[0.5]">
          {t.stats.pct}%
        </span>
      </div>
      <span
        className={`text-[8px] font-semibold w-[52px] text-center ${statusTextColor(
          status
        )}`}
      >
        {statusLabel(status, role)}
      </span>
    </div>
  );
}

// ─── Color / label helpers ────────────────────────────────────────────────

function statusLabel(s: TopicStatus, role: "teacher" | "student"): string {
  const map = {
    teacher: {
      mastered: "שלטו",
      in_progress: "בתהליך",
      struggling: "נכשל",
      not_started: "טרם",
    },
    student: {
      mastered: "שלטת",
      in_progress: "בתהליך",
      struggling: "צריך חיזוק",
      not_started: "טרם",
    },
  } as const;
  return map[role][s];
}

function stripeColor(s: TopicStatus): string {
  switch (s) {
    case "mastered":
      return "#34D399";
    case "in_progress":
      return "#FBBF24";
    case "struggling":
      return "#F87171";
    default:
      return "transparent";
  }
}

function ringStrokeColor(s: TopicStatus): string {
  switch (s) {
    case "mastered":
      return "#34D399";
    case "in_progress":
      return "#FBBF24";
    case "struggling":
      return "#F87171";
    default:
      return "rgba(255,255,255,0.22)";
  }
}

function statusTextColor(s: TopicStatus): string {
  switch (s) {
    case "mastered":
      return "text-[#34D399]";
    case "in_progress":
      return "text-[#FBBF24]";
    case "struggling":
      return "text-[#F87171]";
    default:
      return "text-white/[0.22]";
  }
}

function dotColor(s: TopicStatus): string {
  switch (s) {
    case "mastered":
      return "bg-[#34D399]";
    case "in_progress":
      return "bg-[#FBBF24]";
    case "struggling":
      return "bg-[#F87171]";
    default:
      return "bg-white/[0.08]";
  }
}

function barFillColor(s: TopicStatus): string {
  switch (s) {
    case "mastered":
      return "bg-[#34D399]";
    case "in_progress":
      return "bg-[#FBBF24]";
    case "struggling":
      return "bg-[#F87171]";
    default:
      return "bg-white/[0.08]";
  }
}

// silence unused import
void ChevronLeft;
void Link;
