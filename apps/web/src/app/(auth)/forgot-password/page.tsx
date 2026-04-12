"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import { ArrowLeft, Mail } from "lucide-react";

export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (err: any) {
      setError(err.message ?? t("error.unexpected"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-brand-700">
          {t("forgot.title")}
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          {t("forgot.subtitle")}
        </p>
      </div>

      {sent ? (
        <div className="text-center space-y-4">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <Mail size={24} className="text-green-600" />
          </div>
          <p className="text-sm text-gray-700">
            {t("forgot.sent")}
          </p>
          <p className="text-xs text-gray-400">
            {t("forgot.checkSpam")}
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline mt-4"
          >
            <ArrowLeft size={14} className="rtl:rotate-180" />
            {t("forgot.backToLogin")}
          </Link>
        </div>
      ) : (
        <>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("common.email")}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder={t("forgot.emailPlaceholder")}
              />
            </div>

            {error && (
              <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-600 text-white rounded-lg py-2.5 font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {loading ? t("forgot.sending") : t("forgot.sendLink")}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link
              href="/login"
              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-brand-600 hover:underline"
            >
              <ArrowLeft size={12} className="rtl:rotate-180" />
              {t("forgot.backToLogin")}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
