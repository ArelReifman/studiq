"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { cn } from "@/lib/utils";
import { BookOpen, BarChart2, CalendarDays, Map, LogOut, Menu, X, UserCog } from "lucide-react";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import { Logo } from "@/components/brand/logo";

export default function StudentLayout({
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

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // History is rendered inline on the dashboard now — no separate nav entry.
  const nav = [
    { href: "/student/dashboard", label: t("student.myLesson"), icon: BookOpen },
    { href: "/student/map", label: t("map.title"), icon: Map },
    { href: "/student/book", label: t("student.bookLesson"), icon: CalendarDays },
    { href: "/student/reports", label: t("student.progress"), icon: BarChart2 },
    { href: "/student/profile", label: t("profile.navLabel"), icon: UserCog },
  ];

  function logout() {
    api.post("/auth/logout", {}).catch(() => {});
    clearAuth();
    router.push("/login");
  }

  const sidebarContent = (
    <>
      <div className="px-6 py-5 border-b border-gray-100 text-start">
        <Link
          href="/student/map"
          aria-label="Studiq"
          className="block w-fit hover:opacity-90 transition-opacity"
        >
          <Logo size={28} withWordmark />
        </Link>
        <p className="text-xs text-gray-500 mt-2">{user?.full_name}</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
              pathname === href
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
    </>
  );

  return (
    <div className="min-h-dvh md:flex">
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 h-14 bg-white border-b border-gray-100">
        <button
          onClick={() => setDrawerOpen(true)}
          className="p-2 -ms-2 rounded-lg hover:bg-gray-100"
          aria-label={t("nav.openMenu")}
        >
          <Menu size={22} />
        </button>
        <Link href="/student/map" aria-label="Studiq">
          <Logo size={24} withWordmark />
        </Link>
        <div className="w-9" />
      </header>

      <aside className="hidden md:flex w-60 bg-white border-e border-gray-100 flex-col">
        {sidebarContent}
      </aside>

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
          aria-label={t("nav.closeMenu")}
        >
          <X size={20} />
        </button>
        {sidebarContent}
      </aside>

      <main className="flex-1 overflow-auto md:flex md:flex-col">
        {/* Map page gets a wider, taller stage so its grid fills the viewport.
            Other student pages stay at the default reading width. */}
        <div
          className={cn(
            "mx-auto px-4 sm:px-6 py-6 md:py-8 w-full",
            pathname.includes("/map")
              ? "max-w-[100rem] flex-1 flex flex-col min-h-0"
              : "max-w-4xl"
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
