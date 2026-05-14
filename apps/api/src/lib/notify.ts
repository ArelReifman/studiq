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

  if (!token || !chatId) return; // silently skip if not configured

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
        console.warn("[notify] Telegram API error:", resp.status, body);
        return false;
      }
      return true;
    } catch (err) {
      // Never crash the main request over a notification failure.
      console.warn("[notify] Telegram send failed:", (err as Error).message);
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
    const plain = message.replace(/<[^>]+>/g, "");
    await sendMessage({ text: plain });
  }
}
