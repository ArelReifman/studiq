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

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
      }),
    });
  } catch (err) {
    // Never crash the main request over a notification failure
    console.warn("[notify] Telegram send failed:", (err as Error).message);
  }
}
