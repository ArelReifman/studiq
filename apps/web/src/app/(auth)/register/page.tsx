"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

interface InviteInfo {
  token: string;
  full_name: string;
  grade_level: string | null;
}

export default function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("token");
  const isStudent = !!inviteToken;
  const setAuth = useAuthStore((s) => s.setAuth);

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [inviteError, setInviteError] = useState("");
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Fetch invite details to prefill student name
  useEffect(() => {
    if (!inviteToken) return;
    (async () => {
      try {
        const data = await api.get<InviteInfo>(`/auth/invite/${inviteToken}`);
        setInvite(data);
        setForm((p) => ({ ...p, full_name: data.full_name }));
      } catch (err: any) {
        setInviteError(err.message ?? "Invalid invite link");
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
        ...form,
        role: isStudent ? "student" : "teacher",
        teacher_invite_token: inviteToken ?? undefined,
      });

      // Auto-login right after registration
      const loginData = await api.post<{
        access_token: string;
        user: {
          id: string;
          email: string;
          role: "teacher" | "student";
          full_name: string;
        };
      }>("/auth/login", { email: form.email, password: form.password });

      setAuth(loginData.user, loginData.access_token);

      router.push(
        loginData.user.role === "teacher"
          ? "/teacher/dashboard"
          : "/student/dashboard"
      );
    } catch (err: any) {
      setError(err.message ?? "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  if (isStudent && inviteError) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
        <h1 className="text-2xl font-bold text-brand-700 mb-2">Studiq</h1>
        <p className="text-red-600 font-medium mb-2">Invite link invalid</p>
        <p className="text-sm text-gray-500">{inviteError}</p>
        <Link
          href="/login"
          className="mt-4 inline-block text-brand-600 hover:underline text-sm"
        >
          Go to login
        </Link>
      </div>
    );
  }

  if (isStudent && !invite) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
        <h1 className="text-2xl font-bold text-brand-700 mb-2">Studiq</h1>
        <p className="text-gray-500">Loading invitation…</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold text-brand-700">Studiq</h1>
        <p className="text-gray-500 mt-1">
          {isStudent
            ? "Set up your student account"
            : "Create a teacher account"}
        </p>
      </div>

      {isStudent && invite && (
        <div className="mb-4 bg-brand-50 border border-brand-100 rounded-lg px-4 py-3 text-sm text-brand-700">
          Welcome, <strong>{invite.full_name}</strong>! Choose an email and
          password to create your student account.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Full name
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
            Email
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
            Password
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
          <p className="text-xs text-gray-400 mt-1">At least 8 characters.</p>
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
          {loading ? "Creating account..." : "Create account"}
        </button>
      </form>

      {!isStudent && (
        <p className="text-center text-sm text-gray-500 mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      )}
    </div>
  );
}
