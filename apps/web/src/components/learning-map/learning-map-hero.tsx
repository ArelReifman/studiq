"use client";

/**
 * Hero strip for the student's "My learning map" page — sets a friendly
 * "you're on a journey" tone before they see the topic grid below.
 *
 * The illustration is an inline SVG (mountain + path + flag) so we don't
 * pull in extra image assets and so it inherits brand colors via Tailwind.
 *
 * Teacher view skips this — they want data density, not motivation.
 */
import { useT } from "@/i18n";

export function LearningMapHero({
  studentName,
  overallPct,
}: {
  studentName?: string | null;
  overallPct: number;
}) {
  const t = useT();

  return (
    <div className="relative overflow-hidden rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50 via-white to-white px-5 sm:px-7 py-5 sm:py-6 mb-5">
      {/* Decorative mountain illustration on the far end */}
      <MountainArt />

      <div className="relative z-10 max-w-[60%]">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase text-brand-700 bg-white/70 backdrop-blur rounded-full px-2.5 py-1 border border-brand-100">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
          {t("map.heroBadge")}
        </span>
        <h1 className="mt-3 text-2xl sm:text-3xl font-bold text-gray-900 leading-tight">
          {t("map.myTitle")}
          {studentName ? <span className="text-brand-600"> · {studentName}</span> : null}
        </h1>
        <p className="text-sm text-gray-600 mt-1.5 max-w-md">
          {t("map.mySubtitle")}
        </p>

        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1 max-w-[280px] h-2 bg-white rounded-full overflow-hidden border border-brand-100">
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
    </div>
  );
}

function MountainArt() {
  // Pure decorative — sits on the inline-end (right in RTL, left in LTR)
  // and is partially clipped at small viewports. aria-hidden so screen
  // readers skip it.
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 320 160"
      className="absolute top-0 bottom-0 end-0 h-full w-[320px] opacity-90 pointer-events-none rtl:scale-x-[-1]"
      preserveAspectRatio="xMaxYMid slice"
    >
      <defs>
        <linearGradient id="hero-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E0F2FE" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="hero-mtn" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7DD3FC" />
          <stop offset="100%" stopColor="#0284C7" />
        </linearGradient>
        <linearGradient id="hero-mtn-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#BAE6FD" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>
      </defs>

      {/* Sky wash */}
      <rect x="0" y="0" width="320" height="160" fill="url(#hero-sky)" />

      {/* Back mountain */}
      <path
        d="M 0 130 L 90 60 L 160 110 L 220 75 L 320 130 L 320 160 L 0 160 Z"
        fill="url(#hero-mtn-back)"
        opacity="0.55"
      />

      {/* Front mountain */}
      <path
        d="M 40 145 L 140 50 L 200 100 L 260 70 L 320 120 L 320 160 L 40 160 Z"
        fill="url(#hero-mtn)"
      />

      {/* Snow caps on the front peak */}
      <path
        d="M 140 50 L 158 67 L 145 70 L 132 64 Z"
        fill="#FFFFFF"
        opacity="0.85"
      />
      <path
        d="M 260 70 L 270 80 L 258 82 L 252 78 Z"
        fill="#FFFFFF"
        opacity="0.7"
      />

      {/* Flag on the summit */}
      <line x1="140" y1="50" x2="140" y2="32" stroke="#0F172A" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M 140 32 L 154 36 L 140 42 Z" fill="#F59E0B" />

      {/* Dotted journey path */}
      <path
        d="M 30 145 Q 70 130 90 120 T 120 80 Q 132 62 140 50"
        fill="none"
        stroke="#0EA5E9"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="2 5"
        opacity="0.6"
      />

      {/* Pin at start */}
      <circle cx="30" cy="145" r="4" fill="#0EA5E9" />
      <circle cx="30" cy="145" r="9" fill="#0EA5E9" opacity="0.18" />
    </svg>
  );
}
