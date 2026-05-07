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
            // Realtime subscriptions invalidate the cache when data
            // actually changes, so we can stay "fresh" for much longer
            // than 30s without stale UI. The trade-off is that pages
            // navigated within the staleTime window show cached data
            // instantly — no loading spinner, no flash. That's the
            // single biggest perceived-speed win on this app.
            staleTime: 5 * 60_000, // 5 minutes
            gcTime: 30 * 60_000, // keep unused data 30 min
            retry: 1,
            // Don't refetch every time the user tabs back in — Realtime
            // is already telling us about changes, and the focus refetch
            // was causing visible loading flashes for nothing.
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            // Refetch on mount only if the query is actually stale.
            refetchOnMount: false,
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
