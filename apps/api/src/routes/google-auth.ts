import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { teacherGoogleTokens } from "../db/schema.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

function getRedirectUri(): string {
  const base = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000";
  return `${base}/api/auth/google/callback`;
}

function getAppUrl(): string {
  return process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000";
}

export const googleAuthRoutes = new Hono()
  .use(authMiddleware)
  .use(requireRole("teacher"))

  // ── Start OAuth flow: redirect teacher to Google consent screen
  .get("/start", async (c) => {
    const state = crypto.randomUUID();
    const isProduction = process.env["NODE_ENV"] === "production";

    setCookie(c, "google_oauth_state", state, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "Lax",
      path: "/",
      maxAge: 300,
    });

    const params = new URLSearchParams({
      client_id: process.env["GOOGLE_CLIENT_ID"]!,
      redirect_uri: getRedirectUri(),
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
    });

    return c.redirect(`${GOOGLE_AUTH_URL}?${params}`);
  })

  // ── OAuth callback: exchange code for tokens, store in DB
  .get("/callback", async (c) => {
    const teacherId = c.get("userId");
    const { code, state, error } = c.req.query();
    const isProduction = process.env["NODE_ENV"] === "production";
    const appUrl = getAppUrl();

    if (error) {
      return c.redirect(`${appUrl}/teacher/schedule?gcal=error&reason=${encodeURIComponent(error)}`);
    }

    const savedState = getCookie(c, "google_oauth_state");
    deleteCookie(c, "google_oauth_state", { path: "/", secure: isProduction });

    if (!state || state !== savedState) {
      return c.redirect(`${appUrl}/teacher/schedule?gcal=error&reason=state_mismatch`);
    }

    if (!code) {
      return c.redirect(`${appUrl}/teacher/schedule?gcal=error&reason=no_code`);
    }

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env["GOOGLE_CLIENT_ID"]!,
        client_secret: process.env["GOOGLE_CLIENT_SECRET"]!,
        redirect_uri: getRedirectUri(),
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      console.error("[GoogleAuth] Token exchange failed:", await tokenRes.text());
      return c.redirect(`${appUrl}/teacher/schedule?gcal=error&reason=token_exchange`);
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    if (!tokens.refresh_token) {
      return c.redirect(`${appUrl}/teacher/schedule?gcal=error&reason=no_refresh_token`);
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await db
      .insert(teacherGoogleTokens)
      .values({
        teacher_id: teacherId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
      })
      .onConflictDoUpdate({
        target: teacherGoogleTokens.teacher_id,
        set: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: expiresAt,
          updated_at: new Date(),
        },
      });

    return c.redirect(`${appUrl}/teacher/schedule?gcal=connected`);
  })

  // ── Status: is this teacher connected?
  .get("/status", async (c) => {
    const teacherId = c.get("userId");
    const [row] = await db
      .select({ teacher_id: teacherGoogleTokens.teacher_id })
      .from(teacherGoogleTokens)
      .where(eq(teacherGoogleTokens.teacher_id, teacherId))
      .limit(1);
    return c.json({ connected: !!row });
  })

  // ── Disconnect: remove stored tokens
  .delete("/", async (c) => {
    const teacherId = c.get("userId");
    await db
      .delete(teacherGoogleTokens)
      .where(eq(teacherGoogleTokens.teacher_id, teacherId));
    return c.json({ ok: true });
  });
