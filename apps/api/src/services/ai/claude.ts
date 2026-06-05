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

// Defaults preserve the exact pre-Phase-1A behaviour: every caller that does
// not pass `options` gets Haiku + 2048 tokens, byte-for-byte as before.
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOKENS = 2048;

export interface CallClaudeOptions {
  /** Override the model (e.g. Sonnet for full lesson generation). */
  model?: string;
  /** Override the output token budget. */
  maxTokens?: number;
  /**
   * When set, emit one structured metrics log line for this call. Used only by
   * the lesson-generation flows ("lesson_regular" / "lesson_retry"); every
   * other AI flow leaves it unset and is therefore not logged. The log records
   * timings and lengths only — never prompt/response content or any PII.
   */
  flow?: string;
}

export async function callClaude<T>(
  prompt: string,
  parseResponse: (text: string) => T,
  options?: CallClaudeOptions
): Promise<T> {
  const client = getClaudeClient();
  const model = options?.model ?? DEFAULT_MODEL;
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const flow = options?.flow;
  // call_ms is the wall-clock of this callClaude invocation (API round-trip +
  // JSON extraction + parse). It deliberately does NOT include the DB fetches
  // generateLesson runs before calling here — those finish before this point —
  // so it is named call_ms, not total_ms, to avoid implying a full-pipeline
  // measurement. claude_ms below isolates just the Anthropic round-trip.
  const callStartedAt = Date.now();
  let claudeMs = 0;

  // Structured metrics — emits only when a `flow` label is provided, so only
  // lesson-generation calls are logged. Lengths and timings only; the prompt,
  // the response text, student names, notes and ids are never logged.
  const emit = (fields: Record<string, unknown>): void => {
    if (!flow) return;
    console.log(
      JSON.stringify({
        tag: "ai_metrics",
        flow,
        model,
        max_tokens: maxTokens,
        prompt_chars: prompt.length,
        ...fields,
      })
    );
  };

  let message;
  try {
    const calledAt = Date.now();
    message = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
    claudeMs = Date.now() - calledAt;
  } catch (err) {
    emit({
      success: false,
      error_type: "api_error",
      call_ms: Date.now() - callStartedAt,
    });
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
    emit({
      success: false,
      error_type: "bad_response_type",
      claude_ms: claudeMs,
      call_ms: Date.now() - callStartedAt,
    });
    throw new Error("Unexpected response type from Claude");
  }

  // Extract JSON from response (handle markdown code blocks)
  const text = content.text.trim();
  const jsonMatch =
    text.match(/```json\s*([\s\S]*?)\s*```/) ??
    text.match(/```\s*([\s\S]*?)\s*```/);
  const jsonText = jsonMatch?.[1] ?? text;

  try {
    const result = parseResponse(jsonText);
    emit({
      success: true,
      json_parse: "success",
      claude_ms: claudeMs,
      call_ms: Date.now() - callStartedAt,
      response_chars: text.length,
    });
    return result;
  } catch (err) {
    emit({
      success: false,
      error_type: "parse_error",
      json_parse: "failure",
      claude_ms: claudeMs,
      call_ms: Date.now() - callStartedAt,
      response_chars: text.length,
    });
    throw err;
  }
}
