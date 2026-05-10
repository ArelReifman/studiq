import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createHmac, randomBytes } from "node:crypto";
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

// HMAC-sign the teacher_id into the OAuth state so the callback can identify
// the teacher without an auth cookie. Browser navigation from Google strips
// nothing, but the studiq-token cookie's embedded JWT may be expired (Supabase
// access tokens live 1h while the cookie wrapper lasts 7d), so we cannot rely
// on authMiddleware in the callback.
function getHmacSecret(): string {
  return process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "dev-only-fallback-secret";
}

function signState(teacherId: string): string {
  const nonce = randomBytes(16).toString("hex");
  const payload = `${teacherId}.${nonce}`;
  const sig = createHmac("sha256", getHmacSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifyState(state: string): string | null {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [teacherId, nonce, sig] = parts;
  if (!teacherId || !nonce || !sig) return null;
  const expected = createHmac("sha256", getHmacSecret())
    .update(`${teacherId}.${nonce}`)
    .digest("hex");
  if (sig !== expected) return null;
  return teacherId;
}

export const googleAuthRoutes = new Hono()
  // ── Start OAuth flow: returns the Google auth URL.
  // Called via api client (fresh bearer token), not browser navigation.
  .get("/start", authMiddleware, requireRole("teacher"), async (c) => {
    const teacherId = c.get("userId");
    const state = signState(teacherId);

    const params = new URLSearchParams({
      client_id: process.env["GOOGLE_CLIENT_ID"]!,
      redirect_uri: getRedirectUri(),
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
    });

    return c.json({ url: `${GOOGLE_AUTH_URL}?${params}` });
  })

  // ── OAuth callback: NO authMiddleware. teacher_id comes from signed state.
  // This is a browser navigation from Google — the studiq-token cookie may
  // contain an expired JWT, so we cannot use it to identify the teacher.
  .get("/callback", async (c) => {
    const { code, state, error } = c.req.query();
    const appUrl = getAppUrl();

    if (error) {
      return c.redirect(
        `${appUrl}/teacher/schedule?gcal=error&reason=${encodeURIComponent(error)}`
      );
    }

    if (!state) {
      return c.redirect(`${appUrl}/teacher/schedule?gcal=error&reason=no_state`);
    }

    const teacherId = verifyState(state);
    if (!teacherId) {
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
  .get("/status", authMiddleware, requireRole("teacher"), async (c) => {
    const teacherId = c.get("userId");
    const [row] = await db
      .select({ teacher_id: teacherGoogleTokens.teacher_id })
      .from(teacherGoogleTokens)
      .where(eq(teacherGoogleTokens.teacher_id, teacherId))
      .limit(1);
    return c.json({ connected: !!row });
  })

  // ── Disconnect: remove stored tokens
  .delete("/", authMiddleware, requireRole("teacher"), async (c) => {
    const teacherId = c.get("userId");
    await db
      .delete(teacherGoogleTokens)
      .where(eq(teacherGoogleTokens.teacher_id, teacherId));
    return c.json({ ok: true });
  });
