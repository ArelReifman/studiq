"use client";

/**
 * Pre-session briefing card — displayed at the top of the student page so
 * the teacher can see "where we stopped, what was hard, what to focus on"
 * before starting the next session.
 *
 * Content is generated server-side by Claude after each lesson review and
 * stored on student_ai_profiles.next_session_briefing. This component
 * just displays it (no client-side AI calls).
 *
 * Strings are hardcoded Hebrew on purpose — this is a Hebrew-first product.
 */
import { Sparkles } from "lucide-react";

interface StudentBriefingCardProps {
  briefing: string | null;
  studentName: string | null | undefined;
}

export function StudentBriefingCard({
  briefing,
  studentName,
}: StudentBriefingCardProps) {
  if (!briefing) return null;

  return (
    <div
      dir="rtl"
      className="mb-6 rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50 to-white p-5 shadow-sm"
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-100">
          <Sparkles size={16} className="text-brand-600" />
        </div>
        <div>
          <h2 className="font-semibold text-sm text-gray-900">
            כרטיס הכנה לשיעור
          </h2>
          <p className="text-xs text-gray-500">
            {studentName
              ? `מה כדאי לדעת לפני המפגש הבא עם ${studentName}`
              : "מה כדאי לדעת לפני המפגש הבא"}
          </p>
        </div>
      </div>

      <div className="text-sm text-gray-700 whitespace-pre-line leading-relaxed pr-10">
        {briefing}
      </div>
    </div>
  );
}
