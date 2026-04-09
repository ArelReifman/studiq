import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/api";

interface AuthUser {
  id: string;
  email: string;
  role: "teacher" | "student";
  full_name: string;
}

interface AuthStore {
  user: AuthUser | null;
  token: string | null;
  setAuth: (user: AuthUser, token: string) => void;
  clearAuth: () => void;
}

/** Sync auth state to cookie so Next.js middleware can read it server-side */
function syncCookie(user: AuthUser | null, token: string | null) {
  if (typeof document === "undefined") return;
  if (user && token) {
    const value = encodeURIComponent(
      JSON.stringify({ state: { user, token }, version: 0 })
    );
    document.cookie = `studiq-auth-storage=${value}; path=/; max-age=604800; SameSite=Lax`;
  } else {
    document.cookie = "studiq-auth-storage=; path=/; max-age=0";
  }
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      setAuth: (user, token) => {
        api.setToken(token);
        syncCookie(user, token);
        set({ user, token });
      },
      clearAuth: () => {
        api.setToken(null);
        syncCookie(null, null);
        set({ user: null, token: null });
      },
    }),
    {
      name: "studiq-auth-storage",
      onRehydrateStorage: () => (state) => {
        if (state?.token) api.setToken(state.token);
        if (state?.user && state?.token) syncCookie(state.user, state.token);
      },
    }
  )
);
