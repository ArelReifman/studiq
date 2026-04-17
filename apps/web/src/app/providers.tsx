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
            staleTime: 5_000,
            retry: 1,
            refetchOnWindowFocus: true,
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
