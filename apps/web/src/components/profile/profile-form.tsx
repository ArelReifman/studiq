"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useT } from "@/i18n";

interface ProfileResponse {
  id: string;
  full_name: string;
  email: string;
  role: "teacher" | "student";
}

/**
 * Self-service profile form. Used by both student and teacher.
 *
 * UX rules
 *  - The current-password field shows up only when the user actually edits
 *    email or new_password (avoids asking for it for a name-only change).
 *  - We don't pre-fill the password field with anything; empty = no change.
 *  - On success we update the local auth store so the sidebar name updates
 *    instantly.
 */
export function ProfileForm() {
  const t = useT();
  const qc = useQueryClient();
  const setAuth = useAuthStore((s) => s.setAuth);
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const { data, isLoading } = useQuery<ProfileResponse>({
    queryKey: ["profile"],
    queryFn: () => api.get("/profile"),
  });

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Hydrate form once data arrives.
  useEffect(() => {
    if (!data) return;
    setFullName(data.full_name);
    setEmail(data.email);
  }, [data]);

  const nameChanged = data && fullName.trim() !== data.full_name;
  const emailChanged = data && email.trim().toLowerCase() !== data.email.toLowerCase();
  const passwordChanged = newPassword.length > 0;
  const sensitiveChange = !!(emailChanged || passwordChanged);
  const anyChange = nameChanged || emailChanged || passwordChanged;

  const mutation = useMutation({
    mutationFn: (payload: Record<string, string>) =>
      api.patch<{ message: string }>("/profile", payload),
    onSuccess: () => {
      setSavedAt(Date.now());
      setNewPassword("");
      setConfirmPassword("");
      setCurrentPassword("");
      qc.invalidateQueries({ queryKey: ["profile"] });

      // Update local auth store so the sidebar name & email refresh instantly.
      if (user && token) {
        setAuth(
          {
            ...user,
            full_name: nameChanged ? fullName.trim() : user.full_name,
            email: emailChanged ? email.trim().toLowerCase() : user.email,
          },
          token
        );
      }
    },
    onError: (err: Error) => {
      setError(err.message ?? t("error.updateProfile"));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!anyChange) {
      setError(t("profile.nothingChanged"));
      return;
    }

    if (passwordChanged && newPassword !== confirmPassword) {
      setError(t("profile.passwordMismatch"));
      return;
    }

    const payload: Record<string, string> = {};
    if (nameChanged) payload["full_name"] = fullName.trim();
    if (emailChanged) payload["email"] = email.trim().toLowerCase();
    if (passwordChanged) payload["new_password"] = newPassword;
    if (sensitiveChange) payload["current_password"] = currentPassword;

    mutation.mutate(payload);
  }

  if (isLoading || !data) {
    return (
      <div className="text-sm text-gray-400 py-10 text-center">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t("profile.title")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("profile.subtitle")}</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("profile.fullName")}
          </label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("profile.email")}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("profile.newPassword")}
          </label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            autoComplete="new-password"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <p className="text-xs text-gray-400 mt-1">{t("profile.passwordHint")}</p>
        </div>

        {passwordChanged && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("profile.confirmPassword")}
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              autoComplete="new-password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        )}

        {sensitiveChange && (
          <div className="pt-2 border-t border-gray-100">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("profile.currentPassword")}
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              {t("profile.currentPasswordHint")}
            </p>
          </div>
        )}

        {error && (
          <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {savedAt && !error && (
          <p className="text-green-700 text-sm bg-green-50 rounded-lg px-3 py-2">
            {t("profile.saved")}
          </p>
        )}

        <button
          type="submit"
          disabled={mutation.isPending || !anyChange}
          className="bg-brand-600 text-white rounded-lg px-4 py-2 font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {mutation.isPending ? t("profile.saving") : t("profile.save")}
        </button>
      </form>
    </div>
  );
}
