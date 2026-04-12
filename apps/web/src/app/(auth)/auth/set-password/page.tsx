"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth";
import { useT } from "@/i18n";

export default function SetPasswordPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const t = useT();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError(t("register.password8"));
      return;
    }

    if (password !== confirm) {
      setError(t("setPassword.mismatch"));
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }

      // After password reset, redirect to the appropriate dashboard
      if (user?.role === "student") {
        router.replace("/student/dashboard");
      } else if (user?.role === "teacher") {
        router.replace("/teacher/dashboard");
      } else {
        // Recovery flow without user context — send to login
        router.replace("/login");
      }
    } catch (e: any) {
      setError(e.message ?? t("error.passwordUpdate"));
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-brand-700">
          {t("setPassword.title")}
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          {t("setPassword.subtitle")}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("setPassword.newPassword")}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("setPassword.confirm")}
          </label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
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
          {loading ? t("setPassword.saving") : t("setPassword.save")}
        </button>
      </form>
    </div>
  );
}
