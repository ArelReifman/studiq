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

describe("buildLessonGenerationPrompt — retry framing (Phase AI-0.5)", () => {
  it("omits the retry block entirely when retryContext is absent", () => {
    const prompt = build();
    expect(prompt).not.toContain("Retry / Practice Lesson");
    expect(prompt).not.toContain("Teacher Decision: repeat");
  });

  it("includes failed task titles, the teacher note, and same-level framing when retryContext is set", () => {
    const prompt = build({
      retryContext: {
        failedTaskTitles: ["Add fractions", "Simplify 4/8"],
        teacherReviewNote: "Confused fractions with decimals",
        lessonLevel: null,
      },
    });

    expect(prompt).toContain("Retry / Practice Lesson");
    expect(prompt).toContain("Teacher Decision: repeat");
    // Failed task titles surface to Claude.
    expect(prompt).toContain("Add fractions");
    expect(prompt).toContain("Simplify 4/8");
    // Teacher review note surfaces.
    expect(prompt).toContain("Confused fractions with decimals");
    // Same topic / same level + alternative-exercises framing.
    expect(prompt).toContain("SAME topic at the SAME level");
    expect(prompt).toContain("ALTERNATIVE exercises");
    // No concrete level → generic same-level framing.
    expect(prompt).toContain("same level as the previous lesson");
  });

  it("surfaces a concrete predecessor level when one is set", () => {
    const prompt = build({
      retryContext: {
        failedTaskTitles: ["X"],
        teacherReviewNote: null,
        lessonLevel: "medium",
      },
    });
    expect(prompt).toContain("medium — keep the retry at exactly this level");
  });

  it("handles a retry with no failed titles and no note gracefully", () => {
    const prompt = build({
      retryContext: {
        failedTaskTitles: [],
        teacherReviewNote: null,
        lessonLevel: null,
      },
    });
    expect(prompt).toContain("Retry / Practice Lesson");
    expect(prompt).toContain("not specified");
    expect(prompt).toContain("Teacher's review note: none");
  });
});
