import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string) {
  // `undefined` → use the user's browser locale, so Hebrew users see Hebrew
  // formatting and English users see English. Hardcoding "en-US" here forced
  // English regardless of the i18n toggle.
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatPercent(rate: number | string) {
  return `${(Number(rate) * 100).toFixed(0)}%`;
}
