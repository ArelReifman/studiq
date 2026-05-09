import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function getClaudeClient(): Anthropic {
  if (!_client) {
    // .trim() guards against a trailing newline/space accidentally pasted
    // into the Vercel env var — Node's HTTP layer rejects whitespace in
    // header values with a vague TypeError.
    const apiKey = process.env["ANTHROPIC_API_KEY"]?.trim();
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY environment variable is required");
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export async function callClaude<T>(
  prompt: string,
  parseResponse: (text: string) => T
): Promise<T> {
  const client = getClaudeClient();

  let message;
  try {
    message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    // The Anthropic SDK wraps the real network error in `cause`. Surface
    // it so we don't see vague "Connection error." with no detail.
    // Redact API keys — Node's HTTP layer echoes header values into errors,
    // so a malformed key would leak verbatim into the response.
    const redact = (s: string) => s.replace(/sk-ant-[A-Za-z0-9_\-]+/g, "sk-ant-***");
    const cause = (err as { cause?: unknown })?.cause;
    const causeMsg =
      cause instanceof Error
        ? `${cause.name}: ${redact(cause.message)}`
        : cause
          ? redact(String(cause))
          : "no cause";
    const baseMsg = err instanceof Error ? redact(err.message) : redact(String(err));
    throw new Error(`Claude call failed — ${baseMsg} (cause: ${causeMsg})`);
  }

  const content = message.content[0];
  if (!content || content.type !== "text") {
    throw new Error("Unexpected response type from Claude");
  }

  // Extract JSON from response (handle markdown code blocks)
  const text = content.text.trim();
  const jsonMatch =
    text.match(/```json\s*([\s\S]*?)\s*```/) ??
    text.match(/```\s*([\s\S]*?)\s*```/);
  const jsonText = jsonMatch?.[1] ?? text;

  return parseResponse(jsonText);
}
