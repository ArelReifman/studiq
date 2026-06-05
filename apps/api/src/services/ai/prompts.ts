import type { StudentAiProfile, DifficultyReport, TeacherAiFeedback } from "@studiq/types";

export interface LessonLearningMapContext {
  courseName: string;
  topicName: string | null;
  topicDescription: string | null;
  prerequisiteNames: string[];
  resources: Array<{ title: string; description: string | null }>;
}

// Phase AI-0.5: context passed when this generation is a *retry* of a previous
// (failed) lesson. Text only — the student's uploaded solution file is never
// read or included here.
export interface LessonRetryContext {
  failedTaskTitles: string[];
  teacherReviewNote: string | null;
  // The predecessor's level (base/medium/exam), carried so the retry stays at
  // the SAME level. Currently a dormant column (usually null) — when null the
  // prompt falls back to the generic "same level" framing.
  lessonLevel: "base" | "medium" | "exam" | null;
}

export function buildLessonGenerationPrompt(params: {
  studentName: string;
  profile: StudentAiProfile;
  recentDifficulties: DifficultyReport[];
  teacherFeedback: TeacherAiFeedback[];
  teacherStyleSummary: string | null;
  similarLessons: Array<{ content: string }>;
  // Optional Learning Map anchoring. When null, the block is omitted entirely
  // and the prompt is byte-identical to the pre-AI-1 version.
  learningMap?: LessonLearningMapContext | null;
  // Optional retry framing (Phase AI-0.5). When null, omitted entirely so the
  // prompt is unchanged for normal (non-retry) generation.
  retryContext?: LessonRetryContext | null;
}): string {
  const {
    studentName,
    profile,
    recentDifficulties,
    teacherFeedback,
    teacherStyleSummary,
    similarLessons,
    learningMap,
    retryContext,
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

  // Learning Map context — only rendered when the lesson is anchored to a
  // topic. "prerequisites" are listed as context, NOT as a mastery claim:
  // resolveTopic does not evaluate prerequisite mastery (see its docstring),
  // so the prompt must not assert that they are unmastered.
  const learningMapBlock = learningMap
    ? `
## Learning Map Context
- Course: ${learningMap.courseName}
- Current topic: ${learningMap.topicName ?? "general course practice"}${
        learningMap.topicDescription
          ? ` — ${learningMap.topicDescription}`
          : ""
      }
- Prerequisites for this topic: ${learningMap.prerequisiteNames.join(", ") || "none"}
- Available study materials (titles only — align exercises to these, do not invent others):
${
  learningMap.resources.length > 0
    ? learningMap.resources
        .map(
          (r) => `  • ${r.title}${r.description ? ` — ${r.description}` : ""}`
        )
        .join("\n")
    : "  • none"
}
`
    : "";

  // Retry framing (Phase AI-0.5) — only when this lesson is a retry of a
  // previous failed lesson. Same topic, same level, alternative exercises.
  const retryBlock = retryContext
    ? `
## Retry / Practice Lesson — Teacher Decision: repeat
This is a RETRY lesson on the SAME topic at the SAME level. After reviewing the
student's previous submission, the teacher decided the student needs more
practice before moving on (decision: repeat).
- Tasks the student previously struggled with: ${
        retryContext.failedTaskTitles.length > 0
          ? retryContext.failedTaskTitles.join("; ")
          : "not specified"
      }
- Teacher's review note: ${
        retryContext.teacherReviewNote?.trim()
          ? `"${retryContext.teacherReviewNote.trim()}"`
          : "none"
      }
- Level: ${
        retryContext.lessonLevel
          ? `${retryContext.lessonLevel} — keep the retry at exactly this level`
          : "same level as the previous lesson"
      }
Produce ALTERNATIVE exercises — do NOT repeat the identical tasks. Approach the
same weak points from a different angle, with fresh examples and clearer
explanations, keeping the difficulty at the same level.
`
    : "";

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
${learningMapBlock}${retryBlock}
## Generation Instructions
- Focus 60% of content on weak topics, 40% on reinforcing strong topics
- Match the student's learning style (${profile.learning_style})
- If completion rate is below 70%, make tasks slightly easier
- If completion rate is above 90%, increase challenge
- Include 4–6 homework items and 3–5 todo items
- Homework items should include a brief description explaining the exercise
- Todo items are shorter practice tasks (no description needed)
- Do NOT repeat topics from the similar past lessons listed above${
    learningMap
      ? `\n- Anchor this lesson to the "Current topic" above; do not drift to unrelated material`
      : ""
  }${
    retryContext
      ? `\n- This is a retry: give the student a fresh angle on the same weak points — new examples and exercises, never the identical previous tasks, same difficulty level`
      : ""
  }

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

const DECISION_LABEL: Record<string, string> = {
  repeat:     "חזרה על אותה רמה — התלמיד עוד לא מוכן",
  next_level: "מעבר לרמה הבאה באותו נושא",
  next_topic: "מעבר לנושא הבא — התלמיד שלט בחומר",
};

export function buildProfileUpdatePrompt(params: {
  studentName: string;
  currentSummary: string | null;
  lessonTitle: string;
  completedCount: number;
  failedCount: number;
  failedTopics: string[];
  studentReflection: string | null;
  teacherReviewNote: string | null;
  teacherDecision: string | null;
  backgroundNote: string | null;
  insights: Array<{ content: string; created_at: string }>;
}): string {
  const {
    studentName,
    currentSummary,
    lessonTitle,
    completedCount,
    failedCount,
    failedTopics,
    studentReflection,
    teacherReviewNote,
    teacherDecision,
    backgroundNote,
    insights,
  } = params;

  const reflectionSection = studentReflection?.trim()
    ? `\n## Student's Own Words (written after the lesson)\n"${studentReflection.trim()}"\n\nThis is the student's direct self-assessment — pay close attention to what they say was hard or easy. It often reveals learning style and emotional state more accurately than completion rates alone.`
    : "";

  const teacherSection = (teacherDecision || teacherReviewNote?.trim())
    ? `\n## Teacher's Verdict (most authoritative signal)\nDecision: ${teacherDecision ? DECISION_LABEL[teacherDecision] : "not set"}${teacherReviewNote?.trim() ? `\nNote: "${teacherReviewNote.trim()}"` : ""}\n\nThis is the teacher's direct assessment after reviewing the student's submitted solution. It overrides self-reported data. Use it to calibrate what "mastery" means for this teacher.`
    : "";

  const backgroundSection = backgroundNote?.trim()
    ? `\n## Student Background (static context written by teacher)\n${backgroundNote.trim()}`
    : "";

  const insightsSection = insights.length > 0
    ? `\n## What Helps This Student (${insights.length} teacher insights, newest first)\n${insights
        .map((i) => `• ${i.content}  (${new Date(i.created_at).toISOString().slice(0, 10)})`)
        .join("\n")}\n\nThese are observations the teacher discovered over time. Recent ones weigh more. They describe HOW this student learns best — the AI summary should reflect them.`
    : "";

  return `Update the AI learning profile summary for a student based on their latest lesson performance.

## Student: ${studentName}

## Current Profile Summary
${currentSummary ?? "No existing summary — create a new one."}

## Latest Lesson: "${lessonTitle}"
- Tasks completed: ${completedCount}
- Tasks failed: ${failedCount}
- Topics in failed tasks: ${failedTopics.join(", ") || "none"}${reflectionSection}${teacherSection}${backgroundSection}${insightsSection}

Write an updated 2–4 sentence summary capturing:
1. What the student is good at
2. What they struggle with
3. Any notable patterns or learning style observations (weight the student's own reflection heavily if present)

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
  difficultyNotes: Array<{
    note: string;
    topics: string[];
    created_at: string;
  }>;
  manualLessons: Array<{
    title: string;
    description: string;
  }>;
  recentDecisions: Array<{
    lessonTitle: string;
    decision: string;
    note: string | null;
    reviewed_at: string;
  }>;
  totalFeedbackCount: number;
}): string {
  const {
    currentSummary,
    feedbacks,
    difficultyNotes,
    manualLessons,
    recentDecisions,
    totalFeedbackCount,
  } = params;

  const feedbackSection =
    feedbacks.length > 0
      ? feedbacks
          .map(
            (f) =>
              `[${f.feedback_type}${f.sentiment ? ` / ${f.sentiment}` : ""}] "${f.content}"`
          )
          .join("\n")
      : "אין";

  const notesSection =
    difficultyNotes.length > 0
      ? difficultyNotes
          .map(
            (d) =>
              `נושאים: ${d.topics.join(", ")} — הערה: "${d.note}"`
          )
          .join("\n")
      : "אין";

  const lessonsSection =
    manualLessons.length > 0
      ? manualLessons
          .map((l) => `• "${l.title}"${l.description ? `: ${l.description}` : ""}`)
          .join("\n")
      : "אין";

  const decisionsSection = recentDecisions.length > 0
    ? recentDecisions.map((d) => {
        const label = { repeat: "חזרה", next_level: "רמה הבאה", next_topic: "נושא הבא" }[d.decision] ?? d.decision;
        return `• "${d.lessonTitle}" → ${label}${d.note ? ` — "${d.note}"` : ""}`;
      }).join("\n")
    : "אין";

  return `אתה מנתח את כתיבתו של מורה פרטי כדי ללמוד את סגנון ההוראה שלו.
המטרה: לבנות פרופיל שיאפשר ל-AI לייצר שיעורים שנשמעים כאילו המורה הזה עצמו כתב אותם.

## הפרופיל הנוכחי
${currentSummary ?? "אין פרופיל עדיין — בנה חדש על סמך הנתונים למטה."}

## משובים מפורשים שהמורה כתב (${feedbacks.length} חדשים, ${totalFeedbackCount} סה״כ)
${feedbackSection}

## הערות שהמורה הוסיף לדיווחי קושי
${notesSection}

## שיעורים שהמורה יצר ידנית (סגנון כותרות + תיאורים)
${lessonsSection}

## החלטות המורה לאחר בדיקת פתרונות תלמידים (${recentDecisions.length} החלטות אחרונות)
${decisionsSection}

זה הסיגנל החזק ביותר לסטנדרט הדרישות של המורה — מתי הוא אומר "עוד פעם" ומתי "אפשר להמשיך".

## מה לחלץ מהנתונים האלה
חפש דפוסים כמו:
- האם מתחיל בתיאוריה או דוגמה?
- האם מעדיף תרגילים קצרים וממוקדים או שאלות ארוכות?
- איך מגדיר רמת קושי — האם מאתגר מההתחלה?
- מה סגנון הכתיבה — פורמלי, מעודד, ישיר, עם הומור?
- האם יש מינוח ספציפי שחוזר?
- מה הוא תמיד מתקן בשיעורי AI?
- איך הוא מסביר למה תלמיד נכשל?
- מה הקריטריון שלו למעבר נושא — רמת הצלחה? איכות הפתרון? משהו אחר?

## הנחיות
- כתוב 4–7 משפטים בעברית
- היה ספציפי: "מעדיף להתחיל עם דוגמה מספרית ורק אחר כך ההגדרה הפורמלית"
- אל תאזכר שמות תלמידים
- שמור על דפוסים מאומתים מהפרופיל הקודם, עדכן רק על בסיס עדויות חדשות

Respond ONLY with valid JSON:
{
  "teaching_style_summary": "string (Hebrew)",
  "key_patterns": ["string", "string"]
}`;
}

// ─── Pre-session briefing ─────────────────────────────────────────────────────
// Short Hebrew briefing the teacher reads BEFORE the next session — answers
// "where did we stop, what was hard, what should I focus on today".
// Generated after each lesson review so it's always fresh by next session.
export function buildBriefingPrompt(params: {
  studentName: string;
  lastLessonTitle: string;
  lastDecision: string | null;
  lastReviewNote: string | null;
  studentReflection: string | null;
  weakTopics: string[];
  strongTopics: string[];
  aiSummary: string | null;
  backgroundNote: string | null;
  recentInsights: { content: string }[];
}): string {
  return `אתה עוזר למורה פרטי להתכונן לשיעור הבא עם תלמיד.

תלמיד: ${params.studentName}

שיעור אחרון: "${params.lastLessonTitle}"
${params.lastDecision ? `החלטת המורה: ${params.lastDecision}` : ""}
${params.lastReviewNote ? `הערות המורה: ${params.lastReviewNote}` : ""}
${params.studentReflection ? `איך התלמיד הרגיש: ${params.studentReflection}` : ""}

נושאים חזקים: ${params.strongTopics.join(", ") || "—"}
נושאים חלשים: ${params.weakTopics.join(", ") || "—"}

${params.aiSummary ? `סיכום AI: ${params.aiSummary}` : ""}
${params.backgroundNote ? `רקע התלמיד: ${params.backgroundNote}` : ""}

${
  params.recentInsights.length > 0
    ? `מה עוזר לתלמיד הזה:\n${params.recentInsights
        .map((i) => `- ${i.content}`)
        .join("\n")}`
    : ""
}

המשימה שלך:
כתוב כרטיס הכנה קצר למורה — 3-4 שורות בעברית, בולטים. ענה על:
1. איפה עצרנו (נושא + החלטה)
2. מה היה קשה לתלמיד
3. על מה להתמקד היום
4. טיפ אישי אחד מהרקע/תובנות (אם רלוונטי)

אל תכתוב מבוא או סיכום. רק 3-4 בולטים קצרים, בלשון פנייה למורה ("התלמיד התקשה...", "מומלץ להתחיל ב...").

Respond ONLY with valid JSON:
{
  "briefing": "string (Hebrew, 3-4 short bullets separated by \\n)"
}`;
}

