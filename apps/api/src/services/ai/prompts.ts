import type { StudentAiProfile, DifficultyReport, TeacherAiFeedback } from "@studiq/types";

export function buildLessonGenerationPrompt(params: {
  studentName: string;
  profile: StudentAiProfile;
  recentDifficulties: DifficultyReport[];
  teacherFeedback: TeacherAiFeedback[];
  teacherStyleSummary: string | null;
  similarLessons: Array<{ content: string }>;
}): string {
  const {
    studentName,
    profile,
    recentDifficulties,
    teacherFeedback,
    teacherStyleSummary,
    similarLessons,
  } = params;

  const difficultySummary =
    recentDifficulties.length > 0
      ? recentDifficulties
          .map(
            (d) =>
              `- ${d.description ?? "Unknown"} (topics: ${d.topic_tags.join(", ") || "untagged"})`
          )
          .join("\n")
      : "No recent difficulties recorded.";

  const feedbackSummary =
    teacherFeedback.length > 0
      ? teacherFeedback
          .map((f) => `[${f.feedback_type}] ${f.content}`)
          .join("\n")
      : "No pending teacher feedback.";

  const similarLessonsSummary =
    similarLessons.length > 0
      ? similarLessons.map((l) => `- ${l.content}`).join("\n")
      : "No similar past lessons found.";

  return `You are an adaptive tutoring AI. Generate a personalized lesson for a student.

## Student: ${studentName}

## Performance Profile
- Strong topics: ${profile.strong_topics.join(", ") || "Not yet determined"}
- Weak topics: ${profile.weak_topics.join(", ") || "Not yet determined"}
- Learning style: ${profile.learning_style}
- Average completion rate: ${(Number(profile.avg_completion_rate) * 100).toFixed(0)}%
- Total lessons completed: ${profile.total_lessons}

## AI Summary (accumulated knowledge about this student)
${profile.ai_summary ?? "No summary yet — this may be a new student."}

## Teacher's Teaching Style (learned from past feedback)
${teacherStyleSummary ?? "No teaching style profile yet — use general best practices."}

## Teacher's Guidance for This Student
${profile.teacher_feedback_summary ?? "No teacher feedback yet."}

## Pending Teacher Feedback (not yet incorporated)
${feedbackSummary}

## Recent Difficulties (last sessions)
${difficultySummary}

## Similar Past Lessons (for context, do not repeat these)
${similarLessonsSummary}

## Generation Instructions
- Focus 60% of content on weak topics, 40% on reinforcing strong topics
- Match the student's learning style (${profile.learning_style})
- If completion rate is below 70%, make tasks slightly easier
- If completion rate is above 90%, increase challenge
- Include 4–6 homework items and 3–5 todo items
- Homework items should include a brief description explaining the exercise
- Todo items are shorter practice tasks (no description needed)
- Do NOT repeat topics from the similar past lessons listed above

Respond ONLY with valid JSON matching this schema:
{
  "title": "string",
  "description": "string (2-3 sentences explaining what this lesson covers)",
  "homework_items": [
    { "title": "string", "description": "string", "order_index": number }
  ],
  "todo_items": [
    { "title": "string", "order_index": number }
  ]
}`;
}

export function buildDifficultyTaggingPrompt(
  taskTitle: string,
  taskDescription: string
): string {
  return `You are classifying a student's failed task into academic topic tags.

Failed task: "${taskTitle}"
${taskDescription ? `Description: "${taskDescription}"` : ""}

Identify 1–3 specific academic topics this task relates to. Choose from common academic topics like: algebra, geometry, fractions, word problems, reading comprehension, grammar, writing, programming, etc.

Respond ONLY with valid JSON:
{
  "topic_tags": ["string", "string"],
  "confidence": number  // 0.0 to 1.0
}`;
}

export function buildProfileUpdatePrompt(params: {
  studentName: string;
  currentSummary: string | null;
  lessonTitle: string;
  completedCount: number;
  failedCount: number;
  failedTopics: string[];
}): string {
  const {
    studentName,
    currentSummary,
    lessonTitle,
    completedCount,
    failedCount,
    failedTopics,
  } = params;

  return `Update the AI learning profile summary for a student based on their latest lesson performance.

## Student: ${studentName}

## Current Profile Summary
${currentSummary ?? "No existing summary — create a new one."}

## Latest Lesson: "${lessonTitle}"
- Tasks completed: ${completedCount}
- Tasks failed: ${failedCount}
- Topics in failed tasks: ${failedTopics.join(", ") || "none"}

Write an updated 2–4 sentence summary capturing:
1. What the student is good at
2. What they struggle with
3. Any notable patterns or learning style observations

Respond ONLY with valid JSON:
{
  "ai_summary": "string",
  "strong_topics": ["string"],
  "weak_topics": ["string"],
  "learning_style": "visual" | "step_by_step" | "example_first" | "theory_first" | "unknown"
}`;
}

export function buildReportPrompt(params: {
  studentName: string;
  periodStart: string;
  periodEnd: string;
  totalLessons: number;
  completionRate: number;
  difficultyCount: number;
  topDifficultTopics: string[];
  aiSummary: string | null;
}): string {
  const {
    studentName,
    periodStart,
    periodEnd,
    totalLessons,
    completionRate,
    difficultyCount,
    topDifficultTopics,
    aiSummary,
  } = params;

  return `Generate a weekly progress report for a student.

## Student: ${studentName}
## Period: ${periodStart} to ${periodEnd}

## Stats
- Lessons completed: ${totalLessons}
- Overall completion rate: ${(completionRate * 100).toFixed(0)}%
- Difficulty reports generated: ${difficultyCount}
- Most struggled topics: ${topDifficultTopics.join(", ") || "none"}

## Current AI Profile
${aiSummary ?? "No profile summary available."}

Write a concise teacher-facing report (3–5 sentences) and provide recommendations.

Respond ONLY with valid JSON:
{
  "summary": "string",
  "ai_recommendations": {
    "focus_topics": ["string"],
    "suggested_difficulty": "easier" | "same" | "harder",
    "notes": "string"
  }
}`;
}

export function buildTeacherStyleUpdatePrompt(params: {
  currentSummary: string | null;
  feedbacks: Array<{
    feedback_type: string;
    content: string;
    sentiment: string | null;
    created_at: string;
  }>;
  totalFeedbackCount: number;
}): string {
  const { currentSummary, feedbacks, totalFeedbackCount } = params;

  const feedbackList = feedbacks
    .map(
      (f) =>
        `[${f.feedback_type}${f.sentiment ? ` / ${f.sentiment}` : ""}] "${f.content}"`
    )
    .join("\n");

  return `You are analyzing feedback from a private tutor to learn their teaching style and preferences.
Your job is to write an updated "teaching style profile" that captures HOW this teacher likes to work.

## Current Teaching Style Profile
${currentSummary ?? "No profile yet — create one from scratch based on the feedback below."}

## Latest Feedback Submissions (${feedbacks.length} new, ${totalFeedbackCount} total)
${feedbackList}

## What to Extract
Look for patterns like:
- Lesson structure preferences (theory first vs examples first)
- Difficulty calibration ("always start easy", "push hard on exam prep")
- Topic sequencing preferences
- Homework style (short sharp tasks vs longer problems)
- Communication style cues (formal, encouraging, direct)
- Recurring corrections they make on AI output
- Any specific pedagogical method they consistently prefer

## Instructions
- Write 3–6 sentences in Hebrew
- Be specific and concrete — "מעדיף להתחיל עם דוגמה ואחר כך הסבר תיאורטי"
- Focus on actionable patterns future lesson generation can use
- Do NOT mention specific student names
- Update based on new feedback but preserve validated patterns from before

Respond ONLY with valid JSON:
{
  "teaching_style_summary": "string (Hebrew)",
  "key_patterns": ["string", "string"]
}`;
}
