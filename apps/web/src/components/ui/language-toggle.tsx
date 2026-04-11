"use client";

import { useLocaleStore } from "@/i18n";
import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";

export function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useLocaleStore();
  const router = useRouter();

  function toggle() {
    const next = locale === "he" ? "en" : "he";
    setLocale(next);
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors ${className ?? ""}`}
      title={locale === "he" ? "Switch to English" : "עבור לעברית"}
    >
      <Globe size={14} />
      {locale === "he" ? "EN" : "עב"}
    </button>
  );
}
