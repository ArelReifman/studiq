"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { cn } from "@/lib/utils";
import { Users, LayoutDashboard, MessageSquare, LogOut } from "lucide-react";

export default function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();
  const t = useT();

  const nav = [
    { href: "/teacher/dashboard", label: t("teacher.dashboard"), icon: LayoutDashboard },
    { href: "/teacher/students", label: t("teacher.students"), icon: Users },
    { href: "/teacher/feedback", label: t("teacher.aiFeedback"), icon: MessageSquare },
  ];

  function logout() {
    api.post("/auth/logout", {}).catch(() => {});
    clearAuth();
    router.push("/login");
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 bg-white border-e border-gray-100 flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100">
          <span className="text-xl font-bold text-brand-700">Studiq</span>
          <p className="text-xs text-gray-500 mt-0.5">{user?.full_name}</p>
          <span className="text-xs text-brand-500 font-medium">
            {t("teacher.role")}
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                pathname.startsWith(href)
                  ? "bg-brand-50 text-brand-700 font-medium"
                  : "text-gray-600 hover:bg-gray-50"
              )}
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-gray-100 space-y-1">
          <LanguageToggle className="w-full justify-center" />
          <button
            onClick={logout}
            className="flex items-center gap-3 px-3 py-2 w-full text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <LogOut size={16} />
            {t("common.signOut")}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
