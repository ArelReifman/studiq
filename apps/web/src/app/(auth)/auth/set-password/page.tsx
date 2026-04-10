"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth";

/**
 * Set-password page — shown after a student clicks the invite link
 * and is successfully authenticated via /auth/callback.
 * Lets the student set their own password, then forwards them to
 * onboarding (if student) or dashboard.
 */
export default function SetPasswordPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match");
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

      // Password set — go to onboarding (students) or dashboard (teachers)
      if (user?.role === "student") {
        router.replace("/student/onboarding");
      } else {
        router.replace("/teacher/dashboard");
      }
    } catch (e: any) {
      setError(e.message ?? "Failed to update password");
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-brand-700">Welcome to Studiq</h1>
        <p className="text-gray-500 text-sm mt-1">
          {user?.full_name ? `Hi ${user.full_name}, ` : ""}
          set a password to secure your account
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            New password
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
            Confirm password
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
          {loading ? "Saving..." : "Set password & continue"}
        </button>
      </form>
    </div>
  );
}
