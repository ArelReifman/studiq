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
