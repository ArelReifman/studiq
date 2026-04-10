"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";

/**
 * Auth callback page — handles Supabase redirect after invite link click.
 *
 * When a student clicks the invite link, Supabase returns them here with
 * tokens in the URL hash (e.g. #access_token=...&refresh_token=...&type=recovery).
 * We extract those, store the session in our auth store, then redirect to
 * /auth/set-password so they can set their own password.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [status, setStatus] = useState<"processing" | "error">("processing");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    async function handleCallback() {
      try {
        // Supabase puts tokens in the URL hash after recovery/invite flow
        // e.g. #access_token=xxx&refresh_token=yyy&type=recovery
        // Or #error=access_denied&error_description=... on failure
        const hash = window.location.hash.slice(1);
        const params = new URLSearchParams(hash);

        // Check for errors first
        const hashError = params.get("error_description") || params.get("error");
        if (hashError) {
          setErrorMsg(decodeURIComponent(hashError).replace(/\+/g, " "));
          setStatus("error");
          return;
        }

        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        const type = params.get("type");

        if (!accessToken || !refreshToken) {
          // Maybe tokens are in query string instead
          const queryParams = new URLSearchParams(window.location.search);
          const errorDesc = queryParams.get("error_description");
          if (errorDesc) {
            setErrorMsg(errorDesc);
            setStatus("error");
            return;
          }
          setErrorMsg("Missing authentication tokens in URL");
          setStatus("error");
          return;
        }

        // Set the Supabase session using the tokens
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error || !data.user) {
          setErrorMsg(error?.message ?? "Failed to verify session");
          setStatus("error");
          return;
        }

        // Fetch user profile from our API
        api.setToken(accessToken);
        const profileRes = await api.get<{
          userId: string;
          role: "teacher" | "student";
          profile: { full_name: string; email: string };
        }>("/auth/me");

        // Store auth state in Zustand + cookie
        setAuth(
          {
            id: profileRes.userId,
            email: profileRes.profile.email,
            role: profileRes.role,
            full_name: profileRes.profile.full_name,
          },
          accessToken
        );

        // If this is a recovery/invite flow, send to set-password
        // Otherwise straight to dashboard
        if (type === "recovery" || type === "invite") {
          router.replace("/auth/set-password");
        } else {
          router.replace(
            profileRes.role === "teacher"
              ? "/teacher/dashboard"
              : "/student/dashboard"
          );
        }
      } catch (e: any) {
        setErrorMsg(e.message ?? "Unexpected error");
        setStatus("error");
      }
    }

    handleCallback();
  }, [router, setAuth]);

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
      <h1 className="text-2xl font-bold text-brand-700 mb-2">Studiq</h1>
      {status === "processing" ? (
        <>
          <p className="text-gray-600">Verifying your invitation...</p>
          <div className="mt-4 flex justify-center">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </>
      ) : (
        <>
          <p className="text-red-600 font-medium mb-2">
            Could not verify invitation
          </p>
          <p className="text-sm text-gray-500">{errorMsg}</p>
          <button
            onClick={() => router.push("/login")}
            className="mt-4 text-brand-600 hover:underline text-sm"
          >
            Go to login
          </button>
        </>
      )}
    </div>
  );
}
