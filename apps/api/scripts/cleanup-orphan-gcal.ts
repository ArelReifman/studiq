/**
 * Find and delete orphan Google Calendar events: events on the teacher's
 * primary calendar that look like a Studiq lesson ("שיעור עם …") but aren't
 * referenced by any active booking row in our DB.
 *
 * These come from past sync mishaps — failed approvals that returned null
 * but actually succeeded on Google's side, or events that were re-created
 * by a backfill but the original wasn't deleted.
 *
 * Run: bun run apps/api/scripts/cleanup-orphan-gcal.ts
 */
import { eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { lessonBookings, teacherGoogleTokens } from "../src/db/schema.js";

interface GcalEvent {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  status?: string;
}

async function refresh(teacherId: string, refreshToken: string): Promise<string> {
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
  if (!res.ok) throw new Error(`token refresh: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  await db
    .update(teacherGoogleTokens)
    .set({
      access_token: data.access_token,
      expires_at: new Date(Date.now() + data.expires_in * 1000),
      updated_at: new Date(),
    })
    .where(eq(teacherGoogleTokens.teacher_id, teacherId));
  return data.access_token;
}

async function getAccessToken(teacherId: string): Promise<string | null> {
  const [tok] = await db
    .select()
    .from(teacherGoogleTokens)
    .where(eq(teacherGoogleTokens.teacher_id, teacherId))
    .limit(1);
  if (!tok) return null;
  if (new Date(tok.expires_at) <= new Date()) {
    return refresh(teacherId, tok.refresh_token);
  }
  return tok.access_token;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // Live, valid event IDs we should NEVER delete.
  const liveRows = await db
    .select({
      id: lessonBookings.gcal_event_id,
      teacher_id: lessonBookings.teacher_id,
    })
    .from(lessonBookings)
    .where(
      inArray(lessonBookings.status, [
        "pending",
        "approved",
        "cancel_requested",
      ])
    );
  const liveByTeacher = new Map<string, Set<string>>();
  for (const r of liveRows) {
    if (!r.id) continue;
    if (!liveByTeacher.has(r.teacher_id))
      liveByTeacher.set(r.teacher_id, new Set());
    liveByTeacher.get(r.teacher_id)!.add(r.id);
  }

  const teachers = await db
    .select({ teacher_id: teacherGoogleTokens.teacher_id })
    .from(teacherGoogleTokens);

  let scanned = 0;
  let deleted = 0;

  for (const { teacher_id } of teachers) {
    const accessToken = await getAccessToken(teacher_id);
    if (!accessToken) continue;

    const live = liveByTeacher.get(teacher_id) ?? new Set();

    // Pull events from today onwards. Studiq lessons are titled "שיעור עם …".
    const params = new URLSearchParams({
      timeMin: `${today}T00:00:00Z`,
      maxResults: "250",
      singleEvents: "true",
      q: "שיעור עם",
    });
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      console.warn(`teacher ${teacher_id}: list failed ${res.status}`);
      continue;
    }
    const data = (await res.json()) as { items?: GcalEvent[] };
    const events = data.items ?? [];

    for (const ev of events) {
      if (!ev.id) continue;
      if (ev.status === "cancelled") continue;
      scanned++;
      if (live.has(ev.id)) continue;

      const when =
        ev.start?.dateTime ?? ev.start?.date ?? "?";
      const end = ev.end?.dateTime ?? ev.end?.date ?? "?";
      console.log(
        `[orphan] teacher=${teacher_id} ${when}–${end} "${ev.summary ?? ""}" id=${ev.id}`
      );

      const delRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${ev.id}?sendUpdates=all`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (delRes.ok || delRes.status === 404 || delRes.status === 410) {
        deleted++;
      } else {
        console.warn(`  delete failed: ${delRes.status} ${await delRes.text()}`);
      }
    }
  }

  console.log(`\nDone: scanned ${scanned} events, deleted ${deleted} orphans.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
