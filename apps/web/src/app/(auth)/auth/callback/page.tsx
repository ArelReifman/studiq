"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth";
import { useT } from "@/i18n";
import { api } from "@/lib/api";

export default function AuthCallbackPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const t = useT();
  const [status, setStatus] = useState<"processing" | "error">("processing");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    async function handleCallback() {
      try {
        const hash = window.location.hash.slice(1);
        const params = new URLSearchParams(hash);

        const hashError =
          params.get("error_description") || params.get("error");
        if (hashError) {
          setErrorMsg(decodeURIComponent(hashError).replace(/\+/g, " "));
          setStatus("error");
          return;
        }

        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        const type = params.get("type");

        if (!accessToken || !refreshToken) {
          const queryParams = new URLSearchParams(window.location.search);
          const errorDesc = queryParams.get("error_description");
          if (errorDesc) {
            setErrorMsg(errorDesc);
            setStatus("error");
            return;
          }
          setErrorMsg(t("error.missingTokens"));
          setStatus("error");
          return;
        }

        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error || !data.user) {
          setErrorMsg(error?.message ?? t("error.verifySession"));
          setStatus("error");
          return;
        }

        api.setToken(accessToken);
        const profileRes = await api.get<{
          userId: string;
          role: "teacher" | "student";
          profile: { full_name: string; email: string };
        }>("/auth/me");

        setAuth(
          {
            id: profileRes.userId,
            email: profileRes.profile.email,
            role: profileRes.role,
            full_name: profileRes.profile.full_name,
          },
          accessToken
        );

        if (type === "recovery" || type === "invite") {
          router.replace("/auth/set-password");
        } else {
          router.replace(
            profileRes.role === "teacher"
              ? "/teacher/dashboard"
              : "/student/map"
          );
        }
      } catch (e: any) {
        setErrorMsg(e.message ?? t("error.unexpected"));
        setStatus("error");
      }
    }

    handleCallback();
  }, [router, setAuth]);

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
      <h1 className="text-2xl font-bold text-brand-700 mb-2">
        {t("callback.title")}
      </h1>
      {status === "processing" ? (
        <>
          <p className="text-gray-600">{t("callback.verifying")}</p>
          <div className="mt-4 flex justify-center">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </>
      ) : (
        <>
          <p className="text-red-600 font-medium mb-2">
            {t("callback.failed")}
          </p>
          <p className="text-sm text-gray-500">{errorMsg}</p>
          <button
            onClick={() => router.push("/login")}
            className="mt-4 text-brand-600 hover:underline text-sm"
          >
            {t("callback.goToLogin")}
          </button>
        </>
      )}
    </div>
  );
}
