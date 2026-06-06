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
  /**
   * When true, on a JSON *syntax* parse failure make ONE additional Claude call
   * that fixes the syntax only (same content, same structure), then re-parse.
   * Bounded to a single repair (never a third call). Deliberately skipped when
   * the response was truncated (`stop_reason === "max_tokens"`) — repairing a
   * cut-off document would fabricate missing content. Default false: every
   * other caller keeps the exact single-call behaviour.
   */
  repairJsonOnce?: boolean;
}

/**
 * Repair instruction for the second (syntax-only) call. The malformed text is
 * appended by the caller; it is sent to Claude but never logged.
 */
function buildJsonRepairPrompt(brokenText: string): string {
  return `The following text was supposed to be a single valid JSON document but has a JSON SYNTAX error. Fix ONLY the syntax so it parses.

Strict rules:
- Fix JSON syntax only (quotes, commas, brackets, escaping).
- Keep exactly the same content and the same structure.
- Do NOT add or remove any values.
- Do NOT change any titles, descriptions, or tasks.
- Do NOT invent new values.
- Return the corrected JSON ONLY — no Markdown fences, no explanation.

Text to fix:
${brokenText}`;
}

/** Extract a JSON payload from a model response (handles ```json fences). */
function extractJson(text: string): string {
  const m =
    text.match(/```json\s*([\s\S]*?)\s*```/) ?? text.match(/```\s*([\s\S]*?)\s*```/);
  return m?.[1] ?? text;
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
  // call_ms is the wall-clock of this whole callClaude invocation: all (one or
  // two) Anthropic round-trips + JSON extraction + parse(s). It deliberately
  // does NOT include the DB fetches generateLesson runs before calling here, so
  // it is named call_ms, not total_ms.
  // claude_ms is the SUM of the Anthropic round-trip(s) only — one normally, two
  // when a bounded JSON-repair call is made (so the repair time is included, not
  // hidden). repair_attempted distinguishes the two-call case.
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

  // Redact API keys — Node's HTTP layer echoes header values into errors, so a
  // malformed key would leak verbatim into a surfaced message.
  const redact = (s: string) => s.replace(/sk-ant-[A-Za-z0-9_\-]+/g, "sk-ant-***");
  const wrapApiError = (err: unknown): Error => {
    const cause = (err as { cause?: unknown })?.cause;
    const causeMsg =
      cause instanceof Error
        ? `${cause.name}: ${redact(cause.message)}`
        : cause
          ? redact(String(cause))
          : "no cause";
    const baseMsg = err instanceof Error ? redact(err.message) : redact(String(err));
    return new Error(`Claude call failed — ${baseMsg} (cause: ${causeMsg})`);
  };

  // ── First (and normally only) Anthropic call ──────────────────────────────
  let message;
  try {
    const calledAt = Date.now();
    message = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
    claudeMs += Date.now() - calledAt;
  } catch (err) {
    emit({
      success: false,
      error_type: "api_error",
      call_ms: Date.now() - callStartedAt,
    });
    throw wrapApiError(err);
  }

  const content = message.content[0];
  // Metadata shared by every terminal emit below (lengths + timings only).
  const stopReason = message.stop_reason ?? null;
  const outputTokens = message.usage?.output_tokens ?? null;

  if (!content || content.type !== "text") {
    emit({
      success: false,
      error_type: "bad_response_type",
      claude_ms: claudeMs,
      call_ms: Date.now() - callStartedAt,
      stop_reason: stopReason,
      output_tokens: outputTokens,
    });
    throw new Error("Unexpected response type from Claude");
  }

  const text = content.text.trim();
  const jsonText = extractJson(text);
  // Fields every parse-stage emit carries. response_chars is kept for backward
  // compatibility; initial_response_chars is its explicit Phase-repair name.
  const baseFields = () => ({
    claude_ms: claudeMs,
    call_ms: Date.now() - callStartedAt,
    stop_reason: stopReason,
    output_tokens: outputTokens,
    response_chars: text.length,
    initial_response_chars: text.length,
  });

  // ── First parse ───────────────────────────────────────────────────────────
  try {
    const result = parseResponse(jsonText);
    emit({
      success: true,
      json_parse: "success",
      repair_attempted: false,
      repair_success: false,
      ...baseFields(),
    });
    return result;
  } catch (err) {
    const isSyntax = err instanceof SyntaxError;

    // Truncated output → NEVER repair (would fabricate the missing tail).
    if (isSyntax && stopReason === "max_tokens") {
      emit({
        success: false,
        error_type: "truncated_max_tokens",
        json_parse: "failure",
        repair_attempted: false,
        repair_success: false,
        ...baseFields(),
      });
      throw err;
    }

    // Not eligible for repair: option off, or not a JSON-syntax failure (e.g. a
    // Zod/schema validation error on otherwise-valid JSON). Behave as before.
    if (!options?.repairJsonOnce || !isSyntax) {
      emit({
        success: false,
        error_type: isSyntax ? "parse_error" : "schema_error",
        json_parse: "failure",
        repair_attempted: false,
        repair_success: false,
        ...baseFields(),
      });
      throw err;
    }

    // ── One bounded repair call (syntax only) — never a third call ───────────
    let repairMessage;
    try {
      const calledAt = Date.now();
      repairMessage = await client.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: buildJsonRepairPrompt(text) }],
      });
      claudeMs += Date.now() - calledAt;
    } catch {
      // The repair API call itself failed → throw the ORIGINAL parse error.
      emit({
        success: false,
        error_type: "parse_error",
        json_parse: "failure",
        repair_attempted: true,
        repair_success: false,
        ...baseFields(),
      });
      throw err;
    }

    const repairContent = repairMessage.content[0];
    if (!repairContent || repairContent.type !== "text") {
      emit({
        success: false,
        error_type: "parse_error",
        json_parse: "failure",
        repair_attempted: true,
        repair_success: false,
        ...baseFields(),
        repair_response_chars: 0,
      });
      throw err;
    }

    const repairText = repairContent.text.trim();
    try {
      const result = parseResponse(extractJson(repairText));
      emit({
        success: true,
        json_parse: "success",
        repair_attempted: true,
        repair_success: true,
        ...baseFields(),
        repair_response_chars: repairText.length,
      });
      return result;
    } catch (repairErr) {
      emit({
        success: false,
        error_type: "parse_error",
        json_parse: "failure",
        repair_attempted: true,
        repair_success: false,
        ...baseFields(),
        repair_response_chars: repairText.length,
      });
      // The last parse error.
      throw repairErr;
    }
  }
}
