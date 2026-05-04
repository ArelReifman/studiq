import type { SVGProps } from "react";

type LogoProps = {
  /** Size in pixels. Default 32. */
  size?: number;
  /** Show the wordmark next to the logo. */
  withWordmark?: boolean;
  /** Wordmark text. Default "Studiq". */
  wordmark?: string;
  className?: string;
};

/**
 * Studiq brand logo — a neural node: one central node with three satellites
 * connected by soft strokes, wrapped in a sky→indigo gradient tile.
 * Pairs with Plus Jakarta Sans 800 wordmark.
 */
export function Logo({
  size = 32,
  withWordmark = false,
  wordmark = "Studiq",
  className = "",
}: LogoProps) {
  // dir="ltr" pins the internal order to [mark][gap][wordmark] regardless
  // of the surrounding page direction, so the Studiq brand reads the same
  // way in Hebrew (RTL) and English (LTR) layouts. The wrapper itself can
  // still be aligned to the right by its parent's flex/text-align rules.
  return (
    <span
      dir="ltr"
      className={`inline-flex items-center gap-2 ${className}`}
    >
      <LogoMark width={size} height={size} />
      {withWordmark && (
        <span
          className="font-extrabold tracking-tight text-gray-900"
          style={{ fontSize: Math.round(size * 0.6) }}
        >
          {wordmark}
        </span>
      )}
    </span>
  );
}

export function LogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient
          id="studiq-logo-gradient"
          x1="0"
          y1="0"
          x2="40"
          y2="40"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>

      <rect width="40" height="40" rx="10" fill="url(#studiq-logo-gradient)" />

      <circle cx="20" cy="20" r="2.5" fill="white" />

      <circle cx="20" cy="10" r="2" fill="white" opacity="0.9" />
      <line
        x1="20"
        y1="12"
        x2="20"
        y2="17.5"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />

      <circle cx="12" cy="27" r="2" fill="white" opacity="0.9" />
      <line
        x1="13.4"
        y1="25.6"
        x2="18.4"
        y2="21.4"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />

      <circle cx="28" cy="27" r="2" fill="white" opacity="0.9" />
      <line
        x1="26.6"
        y1="25.6"
        x2="21.6"
        y2="21.4"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  );
}
