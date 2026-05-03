"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { cn } from "@/lib/utils";
import { LayoutDashboard, CalendarClock, LogOut, BookOpen, Menu, X, UserCheck } from "lucide-react";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import { Logo } from "@/components/brand/logo";

export default function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();
  const t = useT();
  useRealtimeSync();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Pending approvals badge — sums registration requests + booking requests.
  // Refreshed on every route change so the count stays accurate after the
  // teacher acts on the approvals page. No realtime: low-volume signal.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<{ count: number }>("/approvals/count").catch(() => ({ count: 0 })),
      api.get<{ count: number }>("/bookings/requests/count").catch(() => ({ count: 0 })),
    ]).then(([reg, book]) => {
      if (!cancelled) setPendingCount(reg.count + book.count);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const nav = [
    { href: "/teacher/dashboard", label: t("teacher.dashboard"), icon: LayoutDashboard },
    { href: "/teacher/approvals", label: t("approvals.navLabel"), icon: UserCheck, badge: pendingCount },
    { href: "/teacher/courses", label: t("teacher.courses"), icon: BookOpen },
    { href: "/teacher/schedule", label: t("teacher.schedule"), icon: CalendarClock },
  ];

  function logout() {
    api.post("/auth/logout", {}).catch(() => {});
    clearAuth();
    router.push("/login");
  }

  const sidebarContent = (
    <>
      <div className="px-6 py-5 border-b border-gray-100">
        <Logo size={28} withWordmark />
        <p className="text-xs text-gray-500 mt-2">{user?.full_name}</p>
        <span className="text-xs text-brand-500 font-medium">
          {t("teacher.role")}
        </span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon, badge }) => (
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
            <span className="flex-1">{label}</span>
            {badge && badge > 0 ? (
              <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 text-[10px] font-bold rounded-full bg-amber-500 text-white">
                {badge}
              </span>
            ) : null}
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
    </>
  );

  return (
    <div className="min-h-dvh md:flex">
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 h-14 bg-white border-b border-gray-100">
        <button
          onClick={() => setDrawerOpen(true)}
          className="p-2 -ms-2 rounded-lg hover:bg-gray-100"
          aria-label="Open menu"
        >
          <Menu size={22} />
        </button>
        <Logo size={24} withWordmark />
        <div className="w-9" />
      </header>

      {/* Desktop sidebar (always visible) */}
      <aside className="hidden md:flex w-60 bg-white border-e border-gray-100 flex-col">
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          "md:hidden fixed top-0 bottom-0 z-50 w-64 bg-white border-e border-gray-100 flex flex-col transition-transform duration-200 ease-out",
          "rtl:right-0 ltr:left-0",
          drawerOpen ? "translate-x-0" : "rtl:translate-x-full ltr:-translate-x-full"
        )}
      >
        <button
          onClick={() => setDrawerOpen(false)}
          className="absolute top-3 end-3 p-2 rounded-lg hover:bg-gray-100"
          aria-label="Close menu"
        >
          <X size={20} />
        </button>
        {sidebarContent}
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 md:py-8">{children}</div>
      </main>
    </div>
  );
}
