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

/** Sync user info to cookie so Next.js middleware can read it server-side */
function syncUserCookie(user: AuthUser | null) {
  if (typeof document === "undefined") return;
  if (user) {
    const value = encodeURIComponent(JSON.stringify(user));
    document.cookie = `studiq-user=${value}; path=/; max-age=604800; SameSite=Lax`;
  } else {
    document.cookie = "studiq-user=; path=/; max-age=0";
    document.cookie = "studiq-token=; path=/; max-age=0";
  }
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      setAuth: (user, token) => {
        api.setToken(token);
        syncUserCookie(user);
        set({ user, token });
      },
      clearAuth: () => {
        api.setToken(null);
        syncUserCookie(null);
        set({ user: null, token: null });
      },
    }),
    {
      name: "studiq-auth-storage",
      onRehydrateStorage: () => (state) => {
        if (state?.token) api.setToken(state.token);
        if (state?.user) syncUserCookie(state.user);
      },
    }
  )
);
