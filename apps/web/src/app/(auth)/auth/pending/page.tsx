"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, LogOut, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useT } from "@/i18n";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { Logo } from "@/components/brand/logo";

export default function PendingApprovalPage() {
  const router = useRouter();
  const { user, clearAuth, setAuth, token } = useAuthStore();
  const t = useT();
  const [checking, setChecking] = useState(false);

  // Periodically re-check status. If the teacher approves, the next /auth/me
  // call returns status='approved' and we forward to the dashboard.
  useEffect(() => {
    if (!token) {
      router.push("/login");
      return;
    }
    const interval = setInterval(checkStatus, 15_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function checkStatus() {
    if (!user || !token) return;
    setChecking(true);
    try {
      const me = await api.get<{ status: "pending" | "approved" | "rejected" }>(
        "/auth/me"
      );
      if (me.status === "approved") {
        setAuth({ ...user, status: "approved" }, token);
        router.push(user.role === "teacher" ? "/teacher/dashboard" : "/student/map");
      } else if (me.status === "rejected") {
        // Rejected — sign them out cleanly.
        await api.post("/auth/logout", {}).catch(() => {});
        clearAuth();
        router.push("/login?rejected=1");
      }
    } catch {
      // Silently swallow — middleware will redirect on real auth failure.
    } finally {
      setChecking(false);
    }
  }

  function logout() {
    api.post("/auth/logout", {}).catch(() => {});
    clearAuth();
    router.push("/login");
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
      <div className="flex justify-center mb-6">
        <Logo size={40} withWordmark />
      </div>

      <div className="w-16 h-16 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center mx-auto mb-5">
        <Clock size={28} className="text-amber-600" />
      </div>

      <h1 className="text-xl font-bold text-gray-900 mb-2">
        {t("pending.title")}
      </h1>
      <p className="text-sm text-gray-500 leading-relaxed mb-6">
        {t("pending.body")}
      </p>

      {user?.email && (
        <div className="bg-gray-50 border border-gray-100 rounded-lg px-4 py-3 mb-6">
          <div className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">
            {t("pending.registeredAs")}
          </div>
          <div className="text-sm font-medium text-gray-900">{user.full_name}</div>
          <div className="text-xs text-gray-500">{user.email}</div>
        </div>
      )}

      <button
        onClick={checkStatus}
        disabled={checking}
        className="w-full h-11 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2 mb-3"
      >
        <RefreshCw size={16} className={checking ? "animate-spin" : ""} />
        {checking ? t("pending.checking") : t("pending.checkAgain")}
      </button>

      <button
        onClick={logout}
        className="w-full h-10 rounded-lg text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
      >
        <LogOut size={14} />
        {t("common.signOut")}
      </button>

      <div className="mt-6 pt-6 border-t border-gray-100">
        <LanguageToggle className="justify-center" />
      </div>
    </div>
  );
}
