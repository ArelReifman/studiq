import { db } from "../db/client.js";
import { teacherGoogleTokens, profiles } from "../db/schema.js";
import { eq } from "drizzle-orm";

async function refreshAccessToken(teacherId: string, refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env["GOOGLE_CLIENT_ID"]!,
      client_secret: process.env["GOOGLE_CLIENT_SECRET"]!,
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

/** Returns the access token for a teacher, refreshing it if needed. Null if no token. */
async function getAccessToken(teacherId: string): Promise<string | null> {
  const [tokens] = await db
    .select()
    .from(teacherGoogleTokens)
    .where(eq(teacherGoogleTokens.teacher_id, teacherId))
    .limit(1);

  if (!tokens) return null;

  if (new Date(tokens.expires_at) <= new Date()) {
    return refreshAccessToken(teacherId, tokens.refresh_token);
  }
  return tokens.access_token;
}

/**
 * Builds the Google Calendar event title and description.
 *
 * Google Calendar uses ONE shared event — both teacher and student see the same title.
 * There is no API to set a different title per side (organizer vs attendee).
 *
 * Title format (with fallbacks):
 *   course + student  → "שיעור פרטי - {courseName} - {studentName}"
 *   course only       → "שיעור פרטי - {courseName}"
 *   student only      → "שיעור פרטי - {studentName}"
 *   neither           → "שיעור פרטי"
 *
 * Description:
 *   סטודנט: {studentName}
 *   מורה: {teacherFirstName}
 *   קורס: {courseName}
 *   זמן שיעור: {startTime}–{endTime}
 */
function buildEventContent(opts: {
  studentName: string;
  teacherName: string;
  courseName: string;
  startTime: string;
  endTime: string;
}): { summary: string; description: string } {
  const { studentName, teacherName, courseName, startTime, endTime } = opts;
  const teacherFirst = teacherName.split(" ")[0] ?? teacherName;

  // Title: "שיעור פרטי - {course} - {student}" with graceful fallbacks
  const hasCourse = !!courseName;
  const hasStudent = !!studentName;
  let summary = "שיעור פרטי";
  if (hasCourse && hasStudent) summary = `שיעור פרטי - ${courseName} - ${studentName}`;
  else if (hasCourse) summary = `שיעור פרטי - ${courseName}`;
  else if (hasStudent) summary = `שיעור פרטי - ${studentName}`;

  // Description: structured block visible in the event details
  const descLines: string[] = [];
  if (hasStudent) descLines.push(`סטודנט: ${studentName}`);
  descLines.push(`מורה: ${teacherFirst}`);
  if (hasCourse) descLines.push(`קורס: ${courseName}`);
  descLines.push(`זמן שיעור: ${startTime}–${endTime}`);

  return { summary, description: descLines.join("\n") };
}

export async function createCalendarEvent(booking: {
  date: string;
  start_time: string;
  end_time: string;
  student_id: string;
  teacher_id: string;
  /** Course name from students.primary_course_id → courses.name. Fallback: "שיעור פרטי". */
  course_name?: string;
  /** Teacher's full_name for the student-facing description line. */
  teacher_name?: string;
}): Promise<string | null> {
  const accessToken = await getAccessToken(booking.teacher_id);
  if (!accessToken) return null;

  const [studentProfile] = await db
    .select({ email: profiles.email, full_name: profiles.full_name })
    .from(profiles)
    .where(eq(profiles.id, booking.student_id))
    .limit(1);

  if (!studentProfile) return null;

  const courseName = booking.course_name ?? "";
  const teacherName = booking.teacher_name ?? "";
  const { summary, description } = buildEventContent({
    studentName: studentProfile.full_name,
    teacherName,
    courseName,
    startTime: booking.start_time,
    endTime: booking.end_time,
  });

  const event = {
    summary,
    description,
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
    console.error("[GoogleCalendar] Failed to create event:", await res.text());
    return null;
  }

  const data = (await res.json()) as { id: string };
  return data.id ?? null;
}

/**
 * Updates an existing Google Calendar event's title, description, and time span.
 * Used for backfilling existing approved bookings with the new title format,
 * and for merging split events into a single span.
 */
export async function updateCalendarEvent(
  teacherId: string,
  gcalEventId: string,
  patch: {
    summary: string;
    description: string;
    date: string;
    start_time: string;
    end_time: string;
  }
): Promise<boolean> {
  const accessToken = await getAccessToken(teacherId);
  if (!accessToken) return false;

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${gcalEventId}?sendUpdates=all`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: patch.summary,
        description: patch.description,
        start: { dateTime: `${patch.date}T${patch.start_time}:00`, timeZone: "Asia/Jerusalem" },
        end: { dateTime: `${patch.date}T${patch.end_time}:00`, timeZone: "Asia/Jerusalem" },
      }),
    }
  );

  if (!res.ok && res.status !== 404 && res.status !== 410) {
    console.error(`[GoogleCalendar] Failed to update event ${gcalEventId}:`, await res.text());
    return false;
  }
  return true;
}

export async function deleteCalendarEvent(
  teacherId: string,
  gcalEventId: string
): Promise<void> {
  const accessToken = await getAccessToken(teacherId);
  if (!accessToken) return;

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
    console.error("[GoogleCalendar] Failed to delete event:", await res.text());
  }
}
