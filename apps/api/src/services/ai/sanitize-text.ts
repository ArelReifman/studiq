/**
 * Deterministic safety net for Hebrew AI output: prompt instructions alone
 * don't guarantee compliance from a fast/cheap model, so this strips the
 * two most common AI-sounding artifacts (long dashes, markdown bold) that
 * still slip through even when the prompt explicitly forbids them.
 * Regular hyphens inside words (e.g. "שלב-אחר-שלב") are left untouched —
 * only em/en dashes and "--" used as a standalone separator are affected.
 */
export function sanitizeHebrewText(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+--\s+/g, ", ")
    .replace(/,\s*,+/g, ",")
    .replace(/\s+([.,])/g, "$1")
    .trim();
}
