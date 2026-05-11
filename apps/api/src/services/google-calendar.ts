import { db } from "../db/client.js";
import { teacherGoogleTokens, profiles } from "../db/schema.js";
import { eq } from "drizzle-orm";

function getGoogleOAuthConfig():
  | { clientId: string; clientSecret: string }
  | null {
  const clientId = process.env["GOOGLE_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];

  if (!clientId || !clientSecret) {
    console.warn(
      "[GoogleCalendar] Skipping calendar side effect: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing."
    );
    return null;
  }

  return { clientId, clientSecret };
}

async function refreshAccessToken(teacherId: string, refreshToken: string): Promise<string> {
  const config = getGoogleOAuthConfig();
  if (!config) {
    throw new Error("Google OAuth credentials are missing");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  await db
    .update(teacherGoogleTokens)
    .set({ access_token: data.access_token, expires_at: expiresAt, updated_at: new Date() })
    .where(eq(teacherGoogleTokens.teacher_id, teacherId));

  return data.access_token;
}

export async function createCalendarEvent(booking: {
  date: string;
  start_time: string;
  end_time: string;
  student_id: string;
  teacher_id: string;
}): Promise<string | null> {
  if (!getGoogleOAuthConfig()) return null;

  const [tokens] = await db
    .select()
    .from(teacherGoogleTokens)
    .where(eq(teacherGoogleTokens.teacher_id, booking.teacher_id))
    .limit(1);

  if (!tokens) return null;

  const [studentProfile] = await db
    .select({ email: profiles.email, full_name: profiles.full_name })
    .from(profiles)
    .where(eq(profiles.id, booking.student_id))
    .limit(1);

  if (!studentProfile) return null;

  let accessToken = tokens.access_token;
  try {
    if (new Date(tokens.expires_at) <= new Date()) {
      accessToken = await refreshAccessToken(booking.teacher_id, tokens.refresh_token);
    }

    const event = {
      summary: `שיעור עם ${studentProfile.full_name}`,
      start: { dateTime: `${booking.date}T${booking.start_time}:00`, timeZone: "Asia/Jerusalem" },
      end: { dateTime: `${booking.date}T${booking.end_time}:00`, timeZone: "Asia/Jerusalem" },
      attendees: [{ email: studentProfile.email }],
      reminders: { useDefault: true },
      guestsCanSeeOtherGuests: false,
      colorId: "2", // Sage
    };

    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      }
    );

    if (!res.ok) {
      console.warn("[GoogleCalendar] Failed to create event:", await res.text());
      return null;
    }

    const data = (await res.json()) as { id: string };
    return data.id ?? null;
  } catch (err) {
    console.warn(
      "[GoogleCalendar] Skipping event creation after Google Calendar error:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

export async function deleteCalendarEvent(
  teacherId: string,
  gcalEventId: string
): Promise<void> {
  if (!getGoogleOAuthConfig()) return;

  const [tokens] = await db
    .select()
    .from(teacherGoogleTokens)
    .where(eq(teacherGoogleTokens.teacher_id, teacherId))
    .limit(1);

  if (!tokens) return;

  let accessToken = tokens.access_token;
  try {
    if (new Date(tokens.expires_at) <= new Date()) {
      accessToken = await refreshAccessToken(teacherId, tokens.refresh_token);
    }

    // sendUpdates=all → Google emails the student a cancellation notice and
    // removes the event from their calendar if they had accepted the invite.
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${gcalEventId}?sendUpdates=all`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!res.ok && res.status !== 404 && res.status !== 410) {
      console.warn("[GoogleCalendar] Failed to delete event:", await res.text());
    }
  } catch (err) {
    console.warn(
      "[GoogleCalendar] Skipping event deletion after Google Calendar error:",
      err instanceof Error ? err.message : String(err)
    );
  }
}
