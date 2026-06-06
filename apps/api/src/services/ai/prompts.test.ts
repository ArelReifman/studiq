import { describe, it, expect } from "vitest";
import { buildLessonGenerationPrompt, truncate } from "./prompts.js";

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

describe("truncate (Phase 1C-a cap helper)", () => {
  it("returns empty for empty or whitespace-only input", () => {
    expect(truncate("", 10)).toBe("");
    expect(truncate("   ", 10)).toBe("");
  });

  it("returns the text unchanged when shorter than or exactly at the cap", () => {
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("abcde", 5)).toBe("abcde"); // exactly the cap
  });

  it("trims before measuring", () => {
    expect(truncate("  abc  ", 5)).toBe("abc");
  });

  it("never exceeds the cap — the ellipsis is inside the budget", () => {
    const out = truncate("x".repeat(50), 10);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toBe("x".repeat(9) + "…");
  });

  it("handles max <= 1 gracefully without overflowing", () => {
    expect(truncate("hello", 1)).toBe("…");
    expect(truncate("hello", 0)).toBe("");
  });

  it("does not mutate its input semantics (pure)", () => {
    const input = "a long string that will be cut";
    const before = input;
    truncate(input, 5);
    expect(input).toBe(before);
  });
});

describe("buildLessonGenerationPrompt — enriched retry context (Phase 1C-a)", () => {
  it("renders failedTasks with their descriptions in a dedicated block", () => {
    const prompt = buildRetry({
      failedTasks: [
        { title: "Add 1/2 + 1/3", description: "Found a common denominator wrong" },
      ],
    });
    expect(prompt).toContain("## Failed tasks — target these directly");
    expect(prompt).toContain("Add 1/2 + 1/3");
    expect(prompt).toContain("Found a common denominator wrong");
  });

  it("falls back to failedTaskTitles (no detail block) when failedTasks is absent", () => {
    // Default buildRetry passes only failedTaskTitles.
    const prompt = buildRetry();
    expect(prompt).toContain("Add fractions");
    expect(prompt).toContain("Simplify 4/8");
    // No description detail block when there are no descriptions.
    expect(prompt).not.toContain("## Failed tasks — target these directly");
  });

  it("does not duplicate failed tasks when both failedTasks and failedTaskTitles are present", () => {
    const prompt = buildRetry({
      failedTasks: [{ title: "RICH_TASK", description: "d" }],
      failedTaskTitles: ["RICH_TASK", "LEGACY_ONLY_TITLE"],
    });
    expect(prompt).toContain("RICH_TASK");
    // The legacy titles-only list is ignored when failedTasks is present.
    expect(prompt).not.toContain("LEGACY_ONLY_TITLE");
  });

  it("renders linkedDifficulties as focused evidence", () => {
    const prompt = buildRetry({
      linkedDifficulties: [
        {
          description: "Mixed up numerator and denominator",
          topicTags: ["fractions"],
          teacherNote: "Saw this twice",
        },
      ],
    });
    expect(prompt).toContain("## Diagnosed difficulties");
    expect(prompt).toContain("Mixed up numerator and denominator");
    expect(prompt).toContain("[topics: fractions]");
    expect(prompt).toContain("teacher note: Saw this twice");
  });

  it("renders the student's reflection", () => {
    const prompt = buildRetry({
      studentReflection: "I got confused when the denominators were different",
    });
    expect(prompt).toContain("## Student's own reflection");
    expect(prompt).toContain("I got confused when the denominators were different");
  });

  it("renders the previous lesson as anti-repeat guidance", () => {
    const prompt = buildRetry({
      previousLesson: {
        title: "Intro to Fractions",
        description: "Visual pizza-slice approach",
        taskTitles: ["Pizza halves", "Pizza thirds"],
      },
    });
    expect(prompt).toContain("## Previous lesson — do NOT repeat these (anti-repeat)");
    expect(prompt).toContain("Intro to Fractions");
    expect(prompt).toContain("Visual pizza-slice approach");
    expect(prompt).toContain("Pizza halves");
    expect(prompt).toContain("do NOT reuse them or their teaching approach");
  });

  it("renders student insights as background", () => {
    const prompt = buildRetry({
      studentInsights: ["Responds well to short sessions", "Likes diagrams"],
    });
    expect(prompt).toContain("## What helps this student (teacher insights");
    expect(prompt).toContain("Responds well to short sessions");
    expect(prompt).toContain("Likes diagrams");
  });

  it("omits every enriched block when its data is empty or null", () => {
    const prompt = buildRetry({
      failedTasks: [{ title: "T", description: null }],
      linkedDifficulties: [],
      studentReflection: null,
      previousLesson: null,
      studentInsights: [],
    });
    expect(prompt).not.toContain("## Failed tasks — target these directly"); // no descriptions
    expect(prompt).not.toContain("## Diagnosed difficulties");
    expect(prompt).not.toContain("## Student's own reflection");
    expect(prompt).not.toContain("## Previous lesson — do NOT repeat");
    expect(prompt).not.toContain("## What helps this student");
  });

  it("applies per-source caps with the ellipsis counted INSIDE the cap", () => {
    const longDesc = "x".repeat(400);
    const longReflection = "y".repeat(700);
    const prompt = buildRetry({
      failedTasks: [{ title: "T", description: longDesc }],
      studentReflection: longReflection,
    });
    // failed task description: total length 300 = 299 x's + ellipsis (NOT 301).
    expect(prompt).toContain("x".repeat(299) + "…");
    expect(prompt).not.toContain("x".repeat(300));
    // reflection: total length 500 = 499 y's + ellipsis (NOT 501).
    expect(prompt).toContain("y".repeat(499) + "…");
    expect(prompt).not.toContain("y".repeat(500));
  });

  it("does not truncate text that is exactly at the cap", () => {
    const exact = "z".repeat(300);
    const prompt = buildRetry({
      failedTasks: [{ title: "T", description: exact }],
    });
    expect(prompt).toContain(exact);
    expect(prompt).not.toContain(exact + "…");
  });

  it("never emits literal undefined/null even with rich context", () => {
    const prompt = buildRetry({
      failedTasks: [{ title: "T", description: "d" }],
      linkedDifficulties: [{ description: null, topicTags: [], teacherNote: null }],
      studentReflection: "r",
      previousLesson: { title: "P", description: null, taskTitles: [] },
      studentInsights: ["i"],
    });
    expect(prompt).not.toContain("undefined");
    expect(prompt).not.toContain("null");
  });

  it("keeps the existing JSON schema with enriched context present", () => {
    const prompt = buildRetry({
      failedTasks: [{ title: "T", description: "d" }],
      linkedDifficulties: [
        { description: "x", topicTags: ["t"], teacherNote: "n" },
      ],
    });
    expect(prompt).toContain('"homework_items"');
    expect(prompt).toContain('"todo_items"');
    expect(prompt).toContain('"order_index"');
    expect(prompt).toContain("Do not add any prose outside the JSON");
  });

  it("preserves the Phase 1B framing when enriched context is present", () => {
    const prompt = buildRetry({
      failedTasks: [{ title: "T", description: "d" }],
      linkedDifficulties: [
        { description: "x", topicTags: ["t"], teacherNote: "n" },
      ],
      studentReflection: "r",
      previousLesson: { title: "P", description: "pd", taskTitles: ["pt"] },
      studentInsights: ["i"],
    });
    expect(prompt).toContain("100%");
    expect(prompt).toContain("override all general lesson-planning guidance");
    expect(prompt).not.toContain(SIXTY_FORTY_DIRECTIVE);
    expect(prompt).toContain("different pedagogical angle");
  });

  it("does not add enriched retry blocks to the regular path", () => {
    const prompt = build();
    expect(prompt).not.toContain("## Failed tasks — target these directly");
    expect(prompt).not.toContain("## Diagnosed difficulties");
    expect(prompt).not.toContain("## Previous lesson — do NOT repeat");
  });
});
