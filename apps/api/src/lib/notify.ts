/**
 * Telegram push notification helper.
 *
 * Env vars required:
 *   TELEGRAM_BOT_TOKEN  – from @BotFather
 *   TELEGRAM_CHAT_ID    – your personal chat ID (get from /getUpdates)
 *
 * If either var is missing the function silently no-ops so dev environments
 * without Telegram configured don't crash.
 */

import { waitUntil } from "@vercel/functions";

/**
 * Escape user-supplied text before embedding in a Telegram HTML message.
 * Telegram's HTML parser only cares about &, <, >.
 * https://core.telegram.org/bots/api#html-style
 */
export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function notifyTelegram(message: string): Promise<void> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];

  // Log exactly which env var is missing so Vercel function logs make the
  // root cause obvious, rather than silently no-opping with no trace.
  if (!token || !chatId) {
    const missing = [
      !token  && "TELEGRAM_BOT_TOKEN",
      !chatId && "TELEGRAM_CHAT_ID",
    ]
      .filter(Boolean)
      .join(", ");
    console.warn(`[notify] Telegram skipped — env not set: ${missing}`);
    return;
  }

  // Log that we're attempting delivery (no secret values printed).
  console.log(
    `[notify] Sending Telegram notification (chat_id length: ${chatId.length})`
  );

  const sendMessage = async (
    payload: Record<string, unknown>
  ): Promise<boolean> => {
    try {
      const resp = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, ...payload }),
        }
      );
      if (!resp.ok) {
        // Log the full Telegram error body so failures are visible in Vercel
        // function logs rather than silently swallowed.
        const body = await resp.text();
        console.warn(`[notify] Telegram API error: ${resp.status} ${body}`);
        return false;
      }
      console.log("[notify] Telegram notification delivered OK");
      return true;
    } catch (err) {
      // Never crash the main request over a notification failure.
      console.warn(`[notify] Telegram fetch threw: ${(err as Error).message}`);
      return false;
    }
  };

  // First attempt: HTML mode for rich formatting (<b>, emoji, etc.).
  const sent = await sendMessage({ text: message, parse_mode: "HTML" });

  // Fallback: plain text — strips HTML tags and retries without parse_mode.
  // Guards against Telegram's "can't parse entities" 400 error which occurs
  // when the message contains characters the HTML parser rejects (e.g. stray
  // angle brackets, unescaped entities, certain Unicode sequences in names).
  if (!sent) {
    console.warn("[notify] HTML mode failed — retrying as plain text");
    const plain = message.replace(/<[^>]+>/g, "");
    const fallbackSent = await sendMessage({ text: plain });
    if (!fallbackSent) {
      console.warn("[notify] Plain text fallback also failed — no Telegram sent");
    }
  }
}

/**
 * Send a document to Telegram via the `sendDocument` API.
 *
 * Telegram fetches `documentUrl` itself (server-side), so the URL must be
 * publicly reachable — the `uploads` bucket is public, so its `getPublicUrl`
 * links qualify. Telegram's URL-fetch path caps documents at ~20 MB; larger
 * files return an API error, in which case this returns `false` and the caller
 * is expected to fall back to a plain text/link message.
 *
 * Mirrors `notifyTelegram`'s env handling: if either env var is missing it
 * no-ops and returns `false`. All failures are caught and logged — this never
 * throws, so a notification problem can never break the upload flow.
 *
 * @returns `true` only when Telegram accepted the document, `false` otherwise.
 */
export async function sendTelegramDocument(
  documentUrl: string,
  caption?: string
): Promise<boolean> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];

  if (!token || !chatId) {
    const missing = [
      !token  && "TELEGRAM_BOT_TOKEN",
      !chatId && "TELEGRAM_CHAT_ID",
    ]
      .filter(Boolean)
      .join(", ");
    console.warn(`[notify] Telegram document skipped — env not set: ${missing}`);
    return false;
  }

  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      document: documentUrl,
    };
    if (caption) {
      payload["caption"] = caption;
      payload["parse_mode"] = "HTML";
    }

    const resp = await fetch(
      `https://api.telegram.org/bot${token}/sendDocument`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    if (!resp.ok) {
      // Common cause: file > ~20 MB (Telegram URL-fetch limit) or an
      // unreachable URL. Log the body so it's visible in Vercel logs, then
      // signal the caller to fall back to a text/link message.
      const body = await resp.text();
      console.warn(`[notify] Telegram sendDocument error: ${resp.status} ${body}`);
      return false;
    }
    console.log("[notify] Telegram document delivered OK");
    return true;
  } catch (err) {
    // Never crash the main request over a notification failure.
    console.warn(`[notify] Telegram sendDocument threw: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Fire-and-forget Telegram notification.
 *
 * On Vercel: registered with `waitUntil` so the function stays alive after
 * `c.json()` returns until Telegram delivery completes (or fails).
 * Outside Vercel (local dev, tests): degrades to a plain fire-and-forget
 * promise — the `.catch()` below guarantees no unhandled rejection.
 *
 * Failures are logged but never thrown — Telegram is a side-channel
 * notification, never on the critical path of a user-facing response.
 */
export function notifyTelegramAsync(message: string): void {
  const promise = notifyTelegram(message).catch((err) => {
    console.warn(
      `[notify] background Telegram failed: ${(err as Error).message}`
    );
  });
  try {
    waitUntil(promise);
  } catch {
    // No Vercel request context (local dev / tests / standalone Node).
    // The promise above is already isolated with .catch(), so it will
    // run to completion in the background without crashing the process.
  }
}
