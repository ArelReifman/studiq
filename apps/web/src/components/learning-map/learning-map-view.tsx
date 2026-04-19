"use client";

import { useMemo, useState } from "react";
import { Flame, Sparkles, Lock } from "lucide-react";
import type {
  LearningMap,
  LearningMapTopic,
  TopicStatus,
} from "@studiq/types";

/**
 * Learning Map — light theme matching Studiq system chrome.
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
  onCreateLesson?: (topicId: string) => void;
}) {
  const topics = map.topics;

  const initialId = useMemo(() => {
    const struggling = topics.find((t) => t.stats.status === "struggling");
    if (struggling) return struggling.id;
    const inProg = topics.find((t) => t.stats.status === "in_progress");
    return inProg?.id ?? topics[0]?.id ?? null;
  }, [topics]);

  const [activeId, setActiveId] = useState<string | null>(initialId);
  const active = topics.find((t) => t.id === activeId) ?? null;

  const recommendation = useMemo(() => {
    const struggling = topics.find(
      (t) => t.stats.status === "struggling" && !t.locked
    );
    if (struggling) return struggling;
    const inProgress = topics
      .filter((t) => t.stats.status === "in_progress" && !t.locked)
      .sort((a, b) => a.stats.pct - b.stats.pct)[0];
    if (inProgress) return inProgress;
    const notStarted = topics.find(
      (t) => t.stats.status === "not_started" && !t.locked
    );
    return notStarted ?? topics.find((t) => !t.locked) ?? null;
  }, [topics]);

  const counts = map.overall;

  return (
    <div
      dir="rtl"
      className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
    >
      {/* TOPBAR */}
      <div className="flex items-center flex-wrap gap-3 h-14 px-5 border-b border-gray-100 bg-gray-50/60">
        <span className="inline-flex items-center text-[10px] font-bold tracking-wider uppercase text-gray-500 border border-gray-200 rounded px-2 py-0.5">
          {role === "teacher" ? "מורה" : "תלמיד"}
        </span>
        <span className="text-sm font-semibold text-gray-900">מפת למידה</span>
        <span className="w-px h-4 bg-gray-200" />
        <span className="text-xs text-gray-500 font-medium truncate">
          {map.course_name}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-4">
          <Stat label="סה״כ" value={counts.total_topics} />
          <Stat label="שלטו" value={counts.mastered} tone="mastered" />
          <Stat
            label="בתהליך"
            value={counts.in_progress}
            tone="in_progress"
          />
          <Stat label="קשיים" value={counts.struggling} tone="struggling" />
          <Stat label="כולל" value={`${counts.overall_pct}%`} />
        </div>
      </div>

      <div className="flex">
        {/* SIDE PANEL */}
        <aside className="w-56 flex-shrink-0 border-s border-gray-100 flex flex-col p-3 gap-3">
          {role === "teacher" && recommendation && (
            <div className="bg-brand-50/60 border border-brand-100 rounded-lg p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-white border border-brand-100 flex items-center justify-center">
                  <Sparkles size={12} className="text-brand-600" />
                </div>
                <span className="text-[10px] font-bold tracking-wider uppercase text-brand-700">
                  המלצת AI
                </span>
              </div>
              <div className="text-[13px] font-semibold text-gray-900 leading-tight line-clamp-2">
                {recommendation.name}
              </div>
              <div className="text-[10px] text-gray-500">
                {recReasonLabel(recommendation.stats.status)}
                {recommendation.stats.tasks_failed > 0 &&
                  ` · ${recommendation.stats.tasks_failed} קשיים`}
              </div>
              <button
                onClick={() => onCreateLesson?.(recommendation.id)}
                className="h-7 rounded-md bg-white border border-brand-200 text-[11px] font-semibold text-brand-700 hover:bg-brand-50 transition-colors"
              >
                צור שיעור
              </button>
            </div>
          )}

          {role === "student" && (
            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Flame size={16} className="text-amber-500" />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-gray-900 leading-tight">
                    {counts.overall_pct}% מהמסלול
                  </div>
                  <div className="text-[10px] text-gray-500">המשך ככה</div>
                </div>
              </div>
              <div className="h-1 bg-gray-200 rounded-full overflow-hidden relative">
                <div
                  className="absolute right-0 top-0 bottom-0 bg-green-500 rounded-full"
                  style={{ width: `${counts.overall_pct}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-gray-400">
                <span>{counts.mastered} שלטת</span>
                <span>{counts.in_progress} בתהליך</span>
              </div>
            </div>
          )}

          <div className="text-[10px] font-bold tracking-wider uppercase text-gray-400 px-1 pt-1">
            כל הנושאים
          </div>
          <div className="flex flex-col gap-0.5">
            {topics.map((t) => (
              <button
                key={t.id}
                onClick={() => !t.locked && setActiveId(t.id)}
                disabled={t.locked}
                className={`flex items-center gap-2 h-8 px-2 rounded-md text-start w-full transition-colors ${
                  t.locked
                    ? "opacity-40 cursor-default"
                    : activeId === t.id
                    ? "bg-gray-100"
                    : "hover:bg-gray-50"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotBg(
                    t.stats.status
                  )}`}
                />
                <span
                  className={`text-[11px] flex-1 truncate ${
                    activeId === t.id
                      ? "text-gray-900 font-semibold"
                      : "text-gray-600"
                  }`}
                >
                  {t.name}
                </span>
                <span
                  className={`text-[11px] font-bold tabular-nums ${statusText(
                    t.stats.status
                  )}`}
                >
                  {t.stats.pct}%
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* MAIN */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Card row */}
          <div className="px-5 pt-4 overflow-x-auto">
            <div
              className="flex gap-3 pb-4"
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
                <div className="text-gray-400 text-sm p-6">
                  אין נושאים במסלול הזה עדיין
                </div>
              )}
            </div>
          </div>

          {/* Detail panel */}
          {active && (
            <div className="mx-5 mb-5 border border-gray-100 rounded-lg bg-gray-50/40 overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white">
                <span className="text-sm font-semibold text-gray-900 flex-1 truncate">
                  {active.name}
                </span>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider ${statusText(
                    active.stats.status
                  )}`}
                >
                  {statusLabel(active.stats.status, role)}
                </span>
                {role === "teacher" && !active.locked && (
                  <button
                    onClick={() => onCreateLesson?.(active.id)}
                    className="text-[11px] font-semibold px-3 py-1 rounded-md bg-brand-50 border border-brand-100 text-brand-700 hover:bg-brand-100/70 transition-colors whitespace-nowrap"
                  >
                    צור שיעור בנושא זה
                  </button>
                )}
              </div>

              {/* Stat grid */}
              <div className="grid grid-cols-4 divide-x divide-x-reverse divide-gray-100 border-b border-gray-100">
                <KpiCell
                  label="התקדמות"
                  value={`${active.stats.pct}%`}
                  tone={active.stats.status}
                />
                <KpiCell
                  label="שיעורים"
                  value={active.stats.lessons_total}
                />
                <KpiCell
                  label="משימות"
                  value={`${active.stats.tasks_completed}/${active.stats.tasks_total}`}
                />
                <KpiCell
                  label="קשיים"
                  value={active.stats.tasks_failed}
                  tone={
                    active.stats.tasks_failed > 0
                      ? "struggling"
                      : "not_started"
                  }
                />
              </div>

              {active.children.length > 0 ? (
                <div>
                  {active.children.map((c) => (
                    <SubtopicRow key={c.id} topic={c} role={role} />
                  ))}
                </div>
              ) : (
                <div className="px-4 py-5 text-[12px] text-gray-400 text-center">
                  {active.stats.lessons_total === 0
                    ? role === "teacher"
                      ? "עוד לא נוצרו שיעורים בנושא הזה"
                      : "עוד לא התחלת את הנושא"
                    : "אין תת-נושאים"}
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
    <div className="flex items-baseline gap-1">
      <span className={`text-sm font-bold tabular-nums ${color}`}>
        {value}
      </span>
      <span className="text-[10px] text-gray-400">{label}</span>
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
  const pct = t.stats.pct;

  return (
    <div
      onClick={onClick}
      className={`relative w-[196px] h-[172px] flex-shrink-0 bg-white rounded-lg border p-4 flex flex-col cursor-pointer transition-all ${
        active
          ? "border-brand-300 shadow-md ring-1 ring-brand-100"
          : "border-gray-100 hover:border-gray-200 hover:shadow-sm"
      } ${t.locked ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      {/* stripe */}
      <div
        className={`absolute start-0 top-3 bottom-3 w-[3px] rounded-e ${stripeBg(
          status
        )}`}
      />

      <div className="flex items-center justify-between mb-2">
        <span
          className={`text-[9px] font-bold tracking-wider uppercase ${statusText(
            status
          )}`}
        >
          {statusLabel(status, role)}
        </span>
        {t.locked ? (
          <Lock size={11} className="text-gray-300" />
        ) : (
          <span className="text-[9px] text-gray-400">
            {t.stats.lessons_total} שיעורים
          </span>
        )}
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
            {t.name}
          </div>
          <div className="text-[9px] text-gray-400 mt-1">
            {t.children.length > 0
              ? `${t.children.length} תת-נושאים`
              : "נושא עצמאי"}
          </div>
        </div>
        <ProgressRing pct={pct} status={status} />
      </div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
        {t.stats.tasks_failed > 0 ? (
          <span className="text-[10px] text-red-600 font-medium">
            <b className="tabular-nums">{t.stats.tasks_failed}</b> קשיים
          </span>
        ) : (
          <span className="text-[10px] text-gray-400 tabular-nums">
            {t.stats.tasks_completed}/{t.stats.tasks_total}
          </span>
        )}
        {role === "teacher" && !t.locked ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCreateLesson?.(t.id);
            }}
            className="text-[10px] font-semibold px-2 py-0.5 rounded border border-gray-200 text-gray-600 hover:text-brand-700 hover:border-brand-200 hover:bg-brand-50 transition-colors whitespace-nowrap"
          >
            שיעור
          </button>
        ) : (
          <span
            className={`text-[10px] font-semibold ${statusText(status)}`}
          >
            {pct === 100
              ? "✓"
              : status === "not_started"
              ? "טרם"
              : "המשך"}
          </span>
        )}
      </div>
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
  topic: t,
  role,
}: {
  topic: LearningMapTopic;
  role: "teacher" | "student";
}) {
  const status = t.stats.status;
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
        {t.name}
      </span>
      <div className="flex items-center gap-2">
        <div className="w-16 h-1 bg-gray-200 rounded-full overflow-hidden relative">
          <div
            className={`absolute right-0 top-0 bottom-0 rounded-full ${barBg(
              status
            )}`}
            style={{ width: `${t.stats.pct}%` }}
          />
        </div>
        <span className="text-[11px] font-bold tabular-nums w-7 text-start text-gray-600">
          {t.stats.pct}%
        </span>
      </div>
      <span
        className={`text-[9px] font-semibold w-14 text-center uppercase tracking-wider ${statusText(
          status
        )}`}
      >
        {statusLabel(status, role)}
      </span>
    </div>
  );
}

// ─── Color + label helpers ────────────────────────────────────────────────

function statusLabel(s: TopicStatus, role: "teacher" | "student"): string {
  const map = {
    teacher: {
      mastered: "שלטו",
      in_progress: "בתהליך",
      struggling: "קשיים",
      not_started: "טרם",
    },
    student: {
      mastered: "שלטת",
      in_progress: "בתהליך",
      struggling: "לחיזוק",
      not_started: "טרם",
    },
  } as const;
  return map[role][s];
}

function recReasonLabel(s: TopicStatus): string {
  switch (s) {
    case "struggling":
      return "זוהו קשיים";
    case "in_progress":
      return "בתהליך";
    case "not_started":
      return "טרם התחלתם";
    default:
      return "המשך כאן";
  }
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
      return "bg-transparent";
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

function ringStroke(s: TopicStatus): string {
  switch (s) {
    case "mastered":
      return "#16A34A";
    case "in_progress":
      return "#D97706";
    case "struggling":
      return "#DC2626";
    default:
      return "#D1D5DB";
  }
}
