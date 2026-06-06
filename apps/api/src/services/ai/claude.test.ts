import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock the Anthropic SDK so we control `messages.create` ──────────────────
const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

// getClaudeClient() requires an API key (read lazily on first call).
process.env["ANTHROPIC_API_KEY"] = "sk-ant-test-key";

import { callClaude } from "./claude.js";

/** Build a Claude `messages.create` response with a single text block. */
function textMsg(
  text: string,
  stop_reason: "end_turn" | "max_tokens" = "end_turn",
  output_tokens = 50
) {
  return { content: [{ type: "text", text }], stop_reason, usage: { output_tokens } };
}

/** A non-text (e.g. tool_use) response block. */
function nonTextMsg(stop_reason: "end_turn" | "max_tokens" = "end_turn") {
  return {
    content: [{ type: "tool_use", id: "x", name: "y", input: {} }],
    stop_reason,
    usage: { output_tokens: 5 },
  };
}

const parseJson = (t: string) => JSON.parse(t) as unknown;
const LESSON_OPTS = { flow: "lesson_regular", repairJsonOnce: true } as const;

let logSpy: ReturnType<typeof vi.spyOn>;

function metricLines(): Array<Record<string, unknown>> {
  return (logSpy.mock.calls as unknown[][])
    .map((c) => String(c[0]))
    .filter((s: string) => s.includes('"tag":"ai_metrics"'))
    .map((s: string) => JSON.parse(s) as Record<string, unknown>);
}

beforeEach(() => {
  createMock.mockReset();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
});

describe("callClaude — JSON syntax repair (bounded)", () => {
  it("1. valid JSON → one call, no repair", async () => {
    createMock.mockResolvedValueOnce(textMsg('{"a":1}'));
    const result = await callClaude('p', parseJson, LESSON_OPTS);
    expect(result).toEqual({ a: 1 });
    expect(createMock).toHaveBeenCalledTimes(1);
    const m = metricLines();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ success: true, repair_attempted: false });
  });

  it("2. syntax error then a good repair → exactly two calls, repaired result", async () => {
    createMock
      .mockResolvedValueOnce(textMsg('{"a":1')) // broken
      .mockResolvedValueOnce(textMsg('{"a":1}')); // repaired
    const result = await callClaude("p", parseJson, LESSON_OPTS);
    expect(result).toEqual({ a: 1 });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(metricLines()[0]).toMatchObject({
      success: true,
      repair_attempted: true,
      repair_success: true,
      repair_response_chars: '{"a":1}'.length,
    });
  });

  // The repair result must pass the SAME parseResponse (incl. schema), not just
  // JSON.parse — a schema-style parser proves the full validation runs again.
  const schemaParse = (t: string) => {
    const p = JSON.parse(t) as { ok?: boolean };
    if (!p.ok) throw new Error("schema: missing ok"); // not a SyntaxError
    return p;
  };

  it("2b. repair output is re-validated through the full parser (schema passes)", async () => {
    createMock
      .mockResolvedValueOnce(textMsg('{"ok"')) // syntax-broken
      .mockResolvedValueOnce(textMsg('{"ok":true}')); // valid + passes schema
    const result = await callClaude("p", schemaParse, LESSON_OPTS);
    expect(result).toEqual({ ok: true });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(metricLines()[0]).toMatchObject({ repair_success: true });
  });

  it("2c. repair returns valid JSON that FAILS schema → throws, two calls, no third", async () => {
    createMock
      .mockResolvedValueOnce(textMsg('{"ok"')) // syntax-broken
      .mockResolvedValueOnce(textMsg('{"nope":1}')); // valid JSON, fails schema
    await expect(callClaude("p", schemaParse, LESSON_OPTS)).rejects.toThrow(
      /schema: missing ok/
    );
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(metricLines()[0]).toMatchObject({
      success: false,
      repair_attempted: true,
      repair_success: false,
    });
  });

  it("3. syntax error in both attempts → exactly two calls, throws, no third", async () => {
    createMock
      .mockResolvedValueOnce(textMsg('{"a":1'))
      .mockResolvedValueOnce(textMsg('{"a":1,')); // still broken
    await expect(callClaude("p", parseJson, LESSON_OPTS)).rejects.toThrow();
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(metricLines()[0]).toMatchObject({
      success: false,
      repair_attempted: true,
      repair_success: false,
    });
  });

  it("4. API error on the first call → one call, no repair", async () => {
    createMock.mockRejectedValueOnce(new Error("network boom"));
    await expect(callClaude("p", parseJson, LESSON_OPTS)).rejects.toThrow(
      /Claude call failed/
    );
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(metricLines()[0]).toMatchObject({ error_type: "api_error" });
  });

  it("5. non-text response → one call, no repair", async () => {
    createMock.mockResolvedValueOnce(nonTextMsg());
    await expect(callClaude("p", parseJson, LESSON_OPTS)).rejects.toThrow(
      /Unexpected response type/
    );
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(metricLines()[0]).toMatchObject({ error_type: "bad_response_type" });
  });

  it("6. valid JSON but a non-SyntaxError (schema) → no repair, one call", async () => {
    createMock.mockResolvedValueOnce(textMsg('{"a":1}'));
    const schemaParse = (t: string) => {
      JSON.parse(t); // valid JSON
      throw new Error("schema validation failed"); // not a SyntaxError
    };
    await expect(callClaude("p", schemaParse, LESSON_OPTS)).rejects.toThrow(
      /schema validation/
    );
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(metricLines()[0]).toMatchObject({
      error_type: "schema_error",
      repair_attempted: false,
    });
  });

  it("7. caller without repairJsonOnce → syntax error rethrown, one call", async () => {
    createMock.mockResolvedValueOnce(textMsg('{"a":1'));
    await expect(
      callClaude("p", parseJson, { flow: "lesson_regular" })
    ).rejects.toThrow();
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(metricLines()[0]).toMatchObject({
      error_type: "parse_error",
      repair_attempted: false,
    });
  });

  it("8. stop_reason=max_tokens + syntax error → no repair, one call, truncated category", async () => {
    createMock.mockResolvedValueOnce(textMsg('{"a":1', "max_tokens"));
    await expect(callClaude("p", parseJson, LESSON_OPTS)).rejects.toThrow();
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(metricLines()[0]).toMatchObject({
      error_type: "truncated_max_tokens",
      repair_attempted: false,
      stop_reason: "max_tokens",
    });
  });

  it("9. repair response is non-text → two calls, throws, repair_success=false", async () => {
    createMock
      .mockResolvedValueOnce(textMsg('{"a":1')) // broken
      .mockResolvedValueOnce(nonTextMsg()); // repair returns non-text
    await expect(callClaude("p", parseJson, LESSON_OPTS)).rejects.toThrow();
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(metricLines()[0]).toMatchObject({
      repair_attempted: true,
      repair_success: false,
    });
  });

  it("10. emits exactly one metric line per callClaude, with no prompt/response content", async () => {
    const PROMPT = "SECRET_PROMPT_MARKER";
    const RESPONSE = '{"secret":"RESPONSE_MARKER"}';
    createMock.mockResolvedValueOnce(textMsg(RESPONSE));
    await callClaude(PROMPT, parseJson, LESSON_OPTS);

    const lines = (logSpy.mock.calls as unknown[][])
      .map((c) => String(c[0]))
      .filter((s: string) => s.includes('"tag":"ai_metrics"'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("SECRET_PROMPT_MARKER");
    expect(lines[0]).not.toContain("RESPONSE_MARKER");
    // metadata is present (lengths only)
    expect(metricLines()[0]).toMatchObject({
      flow: "lesson_regular",
      prompt_chars: PROMPT.length,
      initial_response_chars: RESPONSE.length,
    });
  });

  it("does not emit a metric line when flow is unset (back-compat)", async () => {
    createMock.mockResolvedValueOnce(textMsg('{"a":1}'));
    const result = await callClaude("p", parseJson); // no options at all
    expect(result).toEqual({ a: 1 });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(metricLines()).toHaveLength(0);
  });
});
