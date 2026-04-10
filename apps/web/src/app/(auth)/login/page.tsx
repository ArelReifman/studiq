"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { GraduationCap, BookOpen } from "lucide-react";

type Mode = "pick" | "student" | "teacher";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justRegistered = searchParams.get("registered") === "1";
  const setAuth = useAuthStore((s) => s.setAuth);

  const [mode, setMode] = useState<Mode>(
    justRegistered ? "student" : "pick"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await api.post<{
        access_token: string;
        user: {
          id: string;
          email: string;
          role: "teacher" | "student";
          full_name: string;
        };
      }>("/auth/login", { email, password });

      // Verify role matches selected mode
      if (mode === "student" && data.user.role !== "student") {
        setError("This account is not a student account.");
        setLoading(false);
        return;
      }
      if (mode === "teacher" && data.user.role !== "teacher") {
        setError("This account is not a teacher account.");
        setLoading(false);
        return;
      }

      setAuth(data.user, data.access_token);

      router.push(
        data.user.role === "teacher"
          ? "/teacher/dashboard"
          : "/student/dashboard"
      );
    } catch (err: any) {
      setError(err.message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  }

  // ── Role picker screen ──
  if (mode === "pick") {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-8">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-brand-700">Studiq</h1>
          <p className="text-gray-500 mt-1">Welcome! Who are you?</p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => setMode("student")}
            className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-brand-400 hover:bg-brand-50 transition-all group"
          >
            <div className="w-12 h-12 rounded-full bg-brand-100 flex items-center justify-center group-hover:bg-brand-200 transition-colors">
              <GraduationCap size={24} className="text-brand-600" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-gray-800">I&apos;m a Student</p>
              <p className="text-xs text-gray-400">
                Sign in to view your lessons
              </p>
            </div>
          </button>

          <button
            onClick={() => setMode("teacher")}
            className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-brand-400 hover:bg-brand-50 transition-all group"
          >
            <div className="w-12 h-12 rounded-full bg-brand-100 flex items-center justify-center group-hover:bg-brand-200 transition-colors">
              <BookOpen size={24} className="text-brand-600" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-gray-800">I&apos;m a Teacher</p>
              <p className="text-xs text-gray-400">
                Manage students &amp; lessons
              </p>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // ── Login form (student or teacher) ──
  return (
    <div className="bg-white rounded-2xl shadow-lg p-8">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold text-brand-700">Studiq</h1>
        <p className="text-gray-500 mt-1">
          {mode === "student" ? "Student sign in" : "Teacher sign in"}
        </p>
      </div>

      {justRegistered && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
          Account created successfully! Sign in with your email and password.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Email
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
            Password
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
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <div className="mt-6 space-y-2 text-center">
        {mode === "teacher" && (
          <p className="text-sm text-gray-500">
            New teacher?{" "}
            <Link href="/register" className="text-brand-600 hover:underline">
              Create an account
            </Link>
          </p>
        )}
        {mode === "student" && (
          <p className="text-xs text-gray-400">
            Don&apos;t have an account? Ask your teacher for an invite link.
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
          &larr; Back to role selection
        </button>
      </div>
    </div>
  );
}
