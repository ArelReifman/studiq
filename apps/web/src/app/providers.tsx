"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

function TokenRefreshWatcher() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "TOKEN_REFRESHED" && session && user) {
          // Supabase silently refreshed the JWT — update our api client
          api.setToken(session.access_token);
          setAuth(user, session.access_token);
        }
        if (event === "SIGNED_OUT") {
          useAuthStore.getState().clearAuth();
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [setAuth, user]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data stays fresh for 30s. Realtime subscriptions invalidate
            // on actual changes, so a longer staleTime doesn't mean stale
            // UI — it just avoids redundant fetches on every re-render.
            staleTime: 30_000,
            gcTime: 5 * 60_000, // keep unused data 5 min
            retry: 1,
            // Refetch on tab focus + network recovery (safety net beyond Realtime)
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TokenRefreshWatcher />
      {children}
    </QueryClientProvider>
  );
}
