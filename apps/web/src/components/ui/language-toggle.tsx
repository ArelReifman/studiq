"use client";

import { useLocaleStore, useT } from "@/i18n";
import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";

export function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useLocaleStore();
  const t = useT();
  const router = useRouter();

  function toggle() {
    const next = locale === "he" ? "en" : "he";
    setLocale(next);
    router.refresh();
  }

  // The tooltip describes the action in the *current* language so the user
  // reads it before the switch. The button label shows the *target* language
  // abbreviation ("EN" / "עב") — that's the convention for language toggles
  // and is intentional, not a translation gap.
  const title =
    locale === "he" ? t("ui.switchToEnglish") : t("ui.switchToHebrew");
  const targetLabel = locale === "he" ? "EN" : "עב";

  return (
    <button
      onClick={toggle}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors ${className ?? ""}`}
      title={title}
      aria-label={title}
    >
      <Globe size={14} />
      {targetLabel}
    </button>
  );
}
