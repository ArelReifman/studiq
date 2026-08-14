import { describe, it, expect } from "vitest";
import {
  buildLessonGenerationPrompt,
  buildRetryChecklistPrompt,
  truncate,
} from "./prompts.js";

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

describe("buildLessonGenerationPrompt — regular path", () => {
  it("includes the 60/40 weak/strong balance rule", () => {
    expect(build()).toContain("Focus 60% of content on weak topics");
  });
});

describe("truncate (cap helper)", () => {
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

function buildRetryChecklist(
  overrides: Partial<Parameters<typeof buildRetryChecklistPrompt>[0]> = {}
) {
  return buildRetryChecklistPrompt({
    teacherReviewNote: "Confused fractions with decimals",
    failedTasks: [{ title: "Add fractions", description: null }],
    ...overrides,
  });
}

describe("buildRetryChecklistPrompt", () => {
  it("surfaces the teacher review note as the highest-priority input", () => {
    const prompt = buildRetryChecklist();
    expect(prompt).toContain("Confused fractions with decimals");
    expect(prompt).toContain("highest priority");
  });

  it("says the lesson content is duplicated, not generated", () => {
    const prompt = buildRetryChecklist();
    expect(prompt).toContain("duplicated");
  });

  it("renders failed tasks as secondary context", () => {
    const prompt = buildRetryChecklist({
      failedTasks: [
        { title: "Add 1/2 + 1/3", description: "Found a common denominator wrong" },
      ],
    });
    expect(prompt).toContain("## Failed tasks (secondary context)");
    expect(prompt).toContain("Add 1/2 + 1/3");
    expect(prompt).toContain("Found a common denominator wrong");
  });

  it("omits the failed tasks block when there are none", () => {
    const prompt = buildRetryChecklist({ failedTasks: [] });
    expect(prompt).not.toContain("## Failed tasks (secondary context)");
  });

  it("renders linked difficulties as secondary context", () => {
    const prompt = buildRetryChecklist({
      linkedDifficulties: [
        {
          description: "Mixed up numerator and denominator",
          topicTags: ["fractions"],
          teacherNote: "Saw this twice",
        },
      ],
    });
    expect(prompt).toContain("## Diagnosed difficulties (secondary context)");
    expect(prompt).toContain("Mixed up numerator and denominator");
    expect(prompt).toContain("[topics: fractions]");
    expect(prompt).toContain("teacher note: Saw this twice");
  });

  it("renders the student's reflection", () => {
    const prompt = buildRetryChecklist({
      studentReflection: "I got confused when the denominators were different",
    });
    expect(prompt).toContain("## Student's own reflection (secondary context)");
    expect(prompt).toContain("I got confused when the denominators were different");
  });

  it("handles a missing teacher note gracefully", () => {
    const prompt = buildRetryChecklist({ teacherReviewNote: null });
    expect(prompt).toContain("Teacher's review note");
    expect(prompt).toContain("none");
  });

  it("requires the JSON output schema with an items array", () => {
    const prompt = buildRetryChecklist();
    expect(prompt).toContain('"items"');
  });

  it("applies the review-note cap with the ellipsis counted inside the budget", () => {
    const longNote = "n".repeat(2100);
    const prompt = buildRetryChecklist({ teacherReviewNote: longNote });
    expect(prompt).toContain("n".repeat(1999) + "…");
    expect(prompt).not.toContain("n".repeat(2000));
  });

  it("never emits literal undefined/null even with rich context", () => {
    const prompt = buildRetryChecklist({
      failedTasks: [{ title: "T", description: "d" }],
      linkedDifficulties: [{ description: null, topicTags: [], teacherNote: null }],
      studentReflection: "r",
    });
    expect(prompt).not.toContain("undefined");
  });
});
