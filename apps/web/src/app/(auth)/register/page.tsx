"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useT } from "@/i18n";
import { LanguageToggle } from "@/components/ui/language-toggle";

interface InviteInfo {
  token: string;
  full_name: string;
  grade_level: string | null;
}

export default function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("token");
  const roleParam = searchParams.get("role");
  // Three flavors of this page:
  //   ?token=...      → student joining via teacher's invite link (auto-approved)
  //   ?role=student   → student self-registration (lands as pending)
  //   (no params)     → teacher signup
  const hasInvite = !!inviteToken;
  const isStudentSelfSignup = !inviteToken && roleParam === "student";
  const isStudent = hasInvite || isStudentSelfSignup;
  const setAuth = useAuthStore((s) => s.setAuth);
  const t = useT();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [inviteError, setInviteError] = useState("");
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    signup_note: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!inviteToken) return;
    (async () => {
      try {
        const data = await api.get<InviteInfo>(`/auth/invite/${inviteToken}`);
        setInvite(data);
        setForm((p) => ({ ...p, full_name: data.full_name }));
      } catch (err: any) {
        setInviteError(err.message ?? t("error.invalidInvite"));
      }
    })();
  }, [inviteToken]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await api.post("/auth/register", {
        full_name: form.full_name,
        email: form.email,
        password: form.password,
        role: isStudent ? "student" : "teacher",
        teacher_invite_token: inviteToken ?? undefined,
        signup_note: isStudentSelfSignup && form.signup_note ? form.signup_note : undefined,
      });

      const loginData = await api.post<{
        access_token: string;
        user: {
          id: string;
          email: string;
          role: "teacher" | "student";
          full_name: string;
          status?: "pending" | "approved" | "rejected";
        };
      }>("/auth/login", { email: form.email, password: form.password });

      setAuth(loginData.user, loginData.access_token);

      // Self-registered student → waiting room. Otherwise → dashboard.
      if (loginData.user.status === "pending") {
        router.push("/auth/pending");
        return;
      }

      router.push(
        loginData.user.role === "teacher"
          ? "/teacher/dashboard"
          : "/student/map"
      );
    } catch (err: any) {
      setError(err.message ?? t("error.registrationFailed"));
    } finally {
      setLoading(false);
    }
  }

  if (hasInvite && inviteError) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-8 text-center relative">
        <div className="absolute top-4 end-4">
          <LanguageToggle />
        </div>
        <h1 className="text-2xl font-bold text-brand-700 mb-2">{t("register.title")}</h1>
        <p className="text-red-600 font-medium mb-2">{t("register.inviteInvalid")}</p>
        <p className="text-sm text-gray-500">{inviteError}</p>
        <Link
          href="/login"
          className="mt-4 inline-block text-brand-600 hover:underline text-sm"
        >
          {t("register.goToLogin")}
        </Link>
      </div>
    );
  }

  // Only show the "loading invite" splash when we're actually fetching one.
  // Self-signup students (?role=student, no token) skip this entirely.
  if (hasInvite && !invite) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
        <h1 className="text-2xl font-bold text-brand-700 mb-2">{t("register.title")}</h1>
        <p className="text-gray-500">{t("register.loadingInvite")}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8 relative">
      <div className="absolute top-4 end-4">
        <LanguageToggle />
      </div>
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold text-brand-700">{t("register.title")}</h1>
        <p className="text-gray-500 mt-1">
          {isStudent ? t("register.studentSetup") : t("register.teacherSetup")}
        </p>
      </div>

      {hasInvite && invite && (
        <div className="mb-4 bg-brand-50 border border-brand-100 rounded-lg px-4 py-3 text-sm text-brand-700">
          {t("register.welcomeStudent", { name: invite.full_name })}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("register.fullName")}
          </label>
          <input
            type="text"
            name="full_name"
            value={form.full_name}
            onChange={handleChange}
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("common.email")}
          </label>
          <input
            type="email"
            name="email"
            value={form.email}
            onChange={handleChange}
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("common.password")}
          </label>
          <input
            type="password"
            name="password"
            value={form.password}
            onChange={handleChange}
            required
            minLength={8}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <p className="text-xs text-gray-400 mt-1">{t("register.password8")}</p>
        </div>

        {isStudentSelfSignup && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("register.signupNote")}
            </label>
            <textarea
              name="signup_note"
              value={form.signup_note}
              onChange={(e) => setForm((p) => ({ ...p, signup_note: e.target.value }))}
              rows={3}
              maxLength={500}
              placeholder={t("register.signupNotePlaceholder")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
          </div>
        )}

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
          {loading ? t("register.creatingAccount") : t("register.createAccount")}
        </button>
      </form>

      {!isStudent && (
        <p className="text-center text-sm text-gray-500 mt-6">
          {t("register.alreadyHave")}{" "}
          <Link href="/login" className="text-brand-600 hover:underline">
            {t("register.signIn")}
          </Link>
        </p>
      )}
    </div>
  );
}
