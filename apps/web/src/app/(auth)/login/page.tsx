"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth";
import { useT } from "@/i18n";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { GraduationCap, BookOpen, AlertCircle } from "lucide-react";

type Mode = "pick" | "student" | "teacher";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justRegistered = searchParams.get("registered") === "1";
  const setAuth = useAuthStore((s) => s.setAuth);
  const t = useT();

  const [mode, setMode] = useState<Mode>(
    justRegistered ? "student" : "pick"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [authErrorOpen, setAuthErrorOpen] = useState(false);

  // Recovery / magic-link landing forwarder.
  // Supabase normalizes redirect_to back to Site URL (the bare host) even when
  // the requested path is in the allow list, so the verify response lands on
  // "/" with auth tokens in the URL hash. Middleware then redirects unauth'd
  // visitors to /login, dragging the hash with them. We catch the hash here
  // and bounce to /auth/callback which knows how to consume it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (hash && hash.includes("access_token=") && hash.includes("type=")) {
      router.replace(`/auth/callback${hash}`);
    }
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await api.post<{
        access_token: string;
        refresh_token: string;
        user: {
          id: string;
          email: string;
          role: "teacher" | "student";
          full_name: string;
          status?: "pending" | "approved" | "rejected";
        };
      }>("/auth/login", { email, password });

      if (mode === "student" && data.user.role !== "student") {
        setError(t("login.wrongRoleStudent"));
        setLoading(false);
        return;
      }
      if (mode === "teacher" && data.user.role !== "teacher") {
        setError(t("login.wrongRoleTeacher"));
        setLoading(false);
        return;
      }

      // Activate Supabase session so the client auto-refreshes the JWT
      await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });

      setAuth(data.user, data.access_token);

      // Pending users go to the waiting room. Status defaults to 'approved'
      // for older sessions where the server didn't return a status field.
      if (data.user.status === "pending") {
        router.push("/auth/pending");
        return;
      }

      router.push(
        data.user.role === "teacher"
          ? "/teacher/dashboard"
          : "/student/dashboard"
      );
    } catch (err: any) {
      const msg = (err?.message ?? "").toString().toLowerCase();
      const isCredsError =
        msg.includes("invalid credentials") ||
        msg.includes("invalid login") ||
        msg.includes("401");
      const isRejected = msg.includes("account access denied");
      if (isRejected) {
        setError(t("login.rejected"));
      } else if (isCredsError) {
        setAuthErrorOpen(true);
      } else {
        setError(err.message ?? t("error.loginFailed"));
      }
    } finally {
      setLoading(false);
    }
  }

  function dismissAuthError() {
    setAuthErrorOpen(false);
    setError("");
    setPassword("");
    setMode("pick");
  }

  const authErrorModal = authErrorOpen ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
      onClick={dismissAuthError}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
          <AlertCircle size={28} className="text-red-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          {t("login.wrongPasswordTitle")}
        </h2>
        <p className="text-sm text-gray-600 mb-6">
          {t("login.wrongPasswordBody")}
        </p>
        <button
          onClick={dismissAuthError}
          autoFocus
          className="w-full bg-brand-600 text-white rounded-lg py-2.5 font-medium hover:bg-brand-700 transition-colors"
        >
          {t("login.backToMenu")}
        </button>
      </div>
    </div>
  ) : null;

  // ── Role picker screen ──
  if (mode === "pick") {
    return (
      <>
      {authErrorModal}
      <div className="bg-white rounded-2xl shadow-lg p-8 relative">
        <div className="absolute top-4 end-4">
          <LanguageToggle />
        </div>
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-brand-700">{t("login.title")}</h1>
          <p className="text-gray-500 mt-1">{t("login.welcome")}</p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => setMode("student")}
            className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-brand-400 hover:bg-brand-50 transition-all group"
          >
            <div className="w-12 h-12 rounded-full bg-brand-100 flex items-center justify-center group-hover:bg-brand-200 transition-colors">
              <GraduationCap size={24} className="text-brand-600" />
            </div>
            <div className="text-start">
              <p className="font-semibold text-gray-800">{t("login.imStudent")}</p>
              <p className="text-xs text-gray-400">{t("login.studentSubtext")}</p>
            </div>
          </button>

          <button
            onClick={() => setMode("teacher")}
            className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-brand-400 hover:bg-brand-50 transition-all group"
          >
            <div className="w-12 h-12 rounded-full bg-brand-100 flex items-center justify-center group-hover:bg-brand-200 transition-colors">
              <BookOpen size={24} className="text-brand-600" />
            </div>
            <div className="text-start">
              <p className="font-semibold text-gray-800">{t("login.imTeacher")}</p>
              <p className="text-xs text-gray-400">{t("login.teacherSubtext")}</p>
            </div>
          </button>
        </div>
      </div>
      </>
    );
  }

  // ── Login form (student or teacher) ──
  return (
    <>
    {authErrorModal}
    <div className="bg-white rounded-2xl shadow-lg p-8 relative">
      <div className="absolute top-4 end-4">
        <LanguageToggle />
      </div>
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold text-brand-700">{t("login.title")}</h1>
        <p className="text-gray-500 mt-1">
          {mode === "student" ? t("login.studentSignIn") : t("login.teacherSignIn")}
        </p>
      </div>

      {justRegistered && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
          {t("login.registered")}
        </div>
      )}

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
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("common.password")}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
          {loading ? t("login.signingIn") : t("login.signIn")}
        </button>
      </form>

      <div className="mt-6 space-y-2 text-center">
        <p className="text-sm">
          <Link href="/forgot-password" className="text-brand-600 hover:underline">
            {t("login.forgotPassword")}
          </Link>
        </p>
        {mode === "teacher" && (
          <p className="text-sm text-gray-500">
            {t("login.newTeacher")}{" "}
            <Link href="/register" className="text-brand-600 hover:underline">
              {t("login.createAccount")}
            </Link>
          </p>
        )}
        {mode === "student" && (
          <p className="text-sm text-gray-500">
            <Link
              href="/register?role=student"
              className="text-brand-600 hover:underline"
            >
              {t("login.noAccount")}
            </Link>
          </p>
        )}
        <button
          onClick={() => {
            setMode("pick");
            setError("");
            setEmail("");
            setPassword("");
          }}
          className="text-xs text-gray-400 hover:text-brand-600 hover:underline"
        >
          &larr; {t("login.backToRoles")}
        </button>
      </div>
    </div>
    </>
  );
}
