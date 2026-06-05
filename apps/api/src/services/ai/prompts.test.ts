import { describe, it, expect } from "vitest";
import { buildLessonGenerationPrompt } from "./prompts.js";

const baseProfile = {
  strong_topics: ["geometry"],
  weak_topics: ["fractions"],
  learning_style: "step_by_step",
  avg_completion_rate: "0.6",
  total_lessons: 3,
  ai_summary: null,
  teacher_feedback_summary: null,
} as any;

function build(overrides: Partial<Parameters<typeof buildLessonGenerationPrompt>[0]> = {}) {
  return buildLessonGenerationPrompt({
    studentName: "Test Student",
    profile: baseProfile,
    recentDifficulties: [],
    teacherFeedback: [],
    teacherStyleSummary: null,
    similarLessons: [],
    learningMap: null,
    ...overrides,
  });
}

// The exact positive directive that defines the regular weak/strong balance.
// Used to assert it is PRESENT in the regular prompt and ABSENT in retry —
// without brittle whole-string matching on the bare "60%" token.
const SIXTY_FORTY_DIRECTIVE = "Focus 60% of content on weak topics";

function buildRetry(
  retryOverrides: Partial<
    NonNullable<Parameters<typeof buildLessonGenerationPrompt>[0]["retryContext"]>
  > = {}
) {
  return build({
    retryContext: {
      failedTaskTitles: ["Add fractions", "Simplify 4/8"],
      teacherReviewNote: "Confused fractions with decimals",
      lessonLevel: null,
      ...retryOverrides,
    },
  });
}

describe("buildLessonGenerationPrompt — regular path", () => {
  it("includes the 60/40 weak/strong balance rule", () => {
    expect(build()).toContain(SIXTY_FORTY_DIRECTIVE);
  });

  it("uses the regular path (not the retry path) when retryContext is absent", () => {
    const prompt = build();
    expect(prompt).not.toContain("REMEDIAL RETRY");
    expect(prompt).not.toContain("PRIORITY ORDER");
  });

  it("uses the regular path when retryContext is explicitly null", () => {
    const prompt = build({ retryContext: null });
    expect(prompt).toContain(SIXTY_FORTY_DIRECTIVE);
    expect(prompt).not.toContain("PRIORITY ORDER");
  });
});

describe("buildLessonGenerationPrompt — retry path (Phase 1B)", () => {
  it("drops the regular 60/40 directive", () => {
    expect(buildRetry()).not.toContain(SIXTY_FORTY_DIRECTIVE);
  });

  it("states that teacher feedback overrides general guidance", () => {
    expect(buildRetry()).toContain(
      "override all general lesson-planning guidance"
    );
  });

  it("demands 100% focus on the failure point", () => {
    const prompt = buildRetry();
    expect(prompt).toContain("100%");
    expect(prompt).toContain("focus on the failure point");
  });

  it("surfaces the teacher review note", () => {
    expect(buildRetry()).toContain("Confused fractions with decimals");
  });

  it("surfaces the failed task titles", () => {
    const prompt = buildRetry();
    expect(prompt).toContain("Add fractions");
    expect(prompt).toContain("Simplify 4/8");
  });

  it("requires a different pedagogical angle without claiming to know the prior method", () => {
    const prompt = buildRetry();
    expect(prompt).toContain("different pedagogical angle");
    // The cautious framing (we do NOT know the exact previous method).
    expect(prompt).toContain(
      "meaningfully different explanatory angle from the one likely represented by the failed tasks"
    );
  });

  it("requires the full per-task pedagogical structure", () => {
    const prompt = buildRetry();
    expect(prompt).toContain("worked example");
    expect(prompt).toContain("progressive hint");
    expect(prompt).toContain("independent practice");
    expect(prompt).toContain("understanding check");
  });

  it("forbids vague filler tasks", () => {
    const prompt = buildRetry();
    expect(prompt).toContain("practice more");
    expect(prompt).toContain("review the topic");
  });

  it("preserves the existing JSON output schema", () => {
    const prompt = buildRetry();
    expect(prompt).toContain('"homework_items"');
    expect(prompt).toContain('"todo_items"');
    expect(prompt).toContain('"order_index"');
    // No extra prose outside the JSON is requested.
    expect(prompt).toContain("Do not add any prose outside the JSON");
  });

  it("keeps the predecessor level exactly when one is set", () => {
    expect(buildRetry({ lessonLevel: "medium" })).toContain(
      "medium — keep the retry at exactly this level"
    );
  });

  it("handles a retry with no failed titles and no note gracefully", () => {
    const prompt = buildRetry({ failedTaskTitles: [], teacherReviewNote: null });
    expect(prompt).toContain("REMEDIAL RETRY");
    expect(prompt).toContain("not specified");
    expect(prompt).toContain("Teacher's review note (highest priority): none");
  });
});
