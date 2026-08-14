import type { StudentAiProfile, DifficultyReport, TeacherAiFeedback } from "@studiq/types";

export interface LessonLearningMapContext {
  courseName: string;
  topicName: string | null;
  topicDescription: string | null;
  prerequisiteNames: string[];
  resources: Array<{ title: string; description: string | null }>;
}

// Per-source length caps for the retry checklist context. Keep the prompt
// bounded so richer context does not inflate tokens/latency unchecked.
const RETRY_CAPS = {
  failedTaskDescription: 300,
  linkedDifficultyDescription: 200,
  linkedDifficultyTeacherNote: 200,
  linkedDifficulties: 10,
  studentReflection: 500,
  reviewNote: 2000,
} as const;

/**
 * Pure, non-mutating truncation. Trims first; when the trimmed text exceeds
 * `max`, cuts it and appends a single ellipsis — counted INSIDE the cap, so the
 * returned string is always at most `max` characters. Returns "" for
 * empty/whitespace input. Exported for direct unit testing of the boundaries.
 */
export function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  // The ellipsis (1 char) is part of the budget, so slice to `max - 1`.
  if (max <= 1) return "…".slice(0, max); // max=1 → "…", max<=0 → ""
  return `${t.slice(0, max - 1).trimEnd()}…`;
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
}): string {
  const {
    studentName,
    profile,
    recentDifficulties,
    teacherFeedback,
    teacherStyleSummary,
    similarLessons,
    learningMap,
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
${learningMapBlock}
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

// ─── Retry checklist (repeat lessons) ──────────────────────────────────────
// When a teacher marks a lesson "חזרה" (repeat), the retry lesson now
// DUPLICATES the predecessor's material and exercises verbatim (handled in
// generate-lesson.ts, no LLM call needed for that part). The only thing the
// AI still generates for a retry is this: the teacher's free-text review
// note, turned into a short checklist of concrete, independently-actionable
// items — grounded by the failed tasks / linked difficulties / reflection as
// secondary context, same priority ordering as before.
export interface RetryChecklistPromptContext {
  teacherReviewNote: string | null;
  failedTasks: Array<{ title: string; description: string | null }>;
  linkedDifficulties?: Array<{
    description: string | null;
    topicTags: string[];
    teacherNote: string | null;
  }>;
  studentReflection?: string | null;
}

export function buildRetryChecklistPrompt(
  ctx: RetryChecklistPromptContext
): string {
  const reviewNote = ctx.teacherReviewNote?.trim()
    ? `"${truncate(ctx.teacherReviewNote, RETRY_CAPS.reviewNote)}"`
    : "none";

  const failedTasksBlock = ctx.failedTasks.length
    ? `\n## Failed tasks (secondary context)\n${ctx.failedTasks
        .map(
          (t) =>
            `- ${t.title}${
              t.description?.trim()
                ? `: ${truncate(t.description, RETRY_CAPS.failedTaskDescription)}`
                : ""
            }`
        )
        .join("\n")}\n`
    : "";

  const linkedDifficultiesBlock = ctx.linkedDifficulties?.length
    ? `\n## Diagnosed difficulties (secondary context)\n${ctx.linkedDifficulties
        .slice(0, RETRY_CAPS.linkedDifficulties)
        .map((d) => {
          const desc = d.description?.trim()
            ? truncate(d.description, RETRY_CAPS.linkedDifficultyDescription)
            : "unspecified";
          const tags = d.topicTags.length
            ? ` [topics: ${d.topicTags.join(", ")}]`
            : "";
          const note = d.teacherNote?.trim()
            ? ` (teacher note: ${truncate(d.teacherNote, RETRY_CAPS.linkedDifficultyTeacherNote)})`
            : "";
          return `- ${desc}${tags}${note}`;
        })
        .join("\n")}\n`
    : "";

  const reflectionBlock = ctx.studentReflection?.trim()
    ? `\n## Student's own reflection (secondary context)\n"${truncate(
        ctx.studentReflection,
        RETRY_CAPS.studentReflection
      )}"\n`
    : "";

  return `You are helping a private tutor prepare a repeat lesson. The student already attempted this material and did NOT master it; the teacher reviewed the submission, chose "repeat", and wrote a review note. The lesson itself (material + exercises) is being duplicated as-is — your ONLY job is to turn the teacher's note into a checklist.

## Teacher's review note (highest priority — the checklist must come from this)
${reviewNote}
${failedTasksBlock}${linkedDifficultiesBlock}${reflectionBlock}
## Your task
Produce 1 to 8 short checklist items in Hebrew, each one a concrete, independently-actionable point the teacher can verify was addressed when the student retries this lesson. Each item must be traceable to something in the teacher's note (or, if the note is thin, to a failed task / diagnosed difficulty above). Imperative, specific phrasing — never vague filler like "לתרגל יותר" or "לחזור על החומר".

${HEBREW_WRITING_RULES}

Respond ONLY with valid JSON:
{
  "items": ["string (Hebrew)", "string (Hebrew)"]
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
  repeat:     "חזרה על אותה רמה, התלמיד עוד לא מוכן",
  next_level: "מעבר לרמה הבאה באותו נושא",
  next_topic: "מעבר לנושא הבא, התלמיד שלט בחומר",
};

// Shared across every Hebrew-facing teacher prompt (briefing, profile
// summary, report) so the model's writing style is consistent no matter
// which piece of AI-generated text the teacher is reading. Based on the
// ben-adam humanization ruleset.
const HEBREW_WRITING_RULES = `## איך לכתוב, כדי שזה יישמע כמו מורה כתב את זה ולא AI
- אסור בהחלט להשתמש בתו מקף ארוך (—) או במקף כפול (--) בשום מקום בטקסט. במקום זאת השתמש בפסיק, בנקודה, או פצל למשפט חדש.
- אסור להשתמש בכוכביות או בכל תחביר Markdown אחר (**מודגש**, כותרות עם #). כתוב טקסט רגיל בלבד, אין עיצוב.
- אל תשתמש באוגד מנופח: מהווה, הינו/הינה, מתאפיין, נמנה עם. כתוב פשוט "הוא" / "זה".
- הימנע משבחים ריקים ומגברי גודל ריקים: פורץ דרך, עוצמתי, ייחודי, ענק, מטורף. אם אין תוכן קונקרטי מאחורי המילה, אל תשתמש בה.
- הימנע ממחברי שיח מיותרים: חשוב לציין, יש לציין, בנוסף, יתרה מכך, לסיכום. עבור ישר לתוכן.
- הימנע מברירות מחדל פורמליות מיותרות: "אשר" במקום "ש", "כאשר" במקום "כש", "על מנת" במקום "כדי".
- הימנע מפרשנות נטפלת בסוף משפט ("מה שמדגיש את...", "דבר המעיד על..."). אם המשפט עומד בלי הזנב הזה, השמט אותו.
- כתוב כמו מורה מקצועי שכותב הערה אמיתית על תלמיד, לא כמו טקסט שיווקי או כמו תבנית.`;

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
    ? `\n## הרפלקציה של התלמיד (נכתבה אחרי השיעור)\n"${studentReflection.trim()}"\n\nזו ההערכה העצמית הישירה של התלמיד. שים לב במיוחד למה שהוא כתב שהיה קשה או קל, לרוב זה חושף סגנון למידה ומצב רגשי בצורה מדויקת יותר מאחוז השלמה בלבד.`
    : "";

  const teacherSection = (teacherDecision || teacherReviewNote?.trim())
    ? `\n## הערכת המורה (הסיגנל הכי אמין)\nהחלטה: ${teacherDecision ? DECISION_LABEL[teacherDecision] : "לא נקבעה"}${teacherReviewNote?.trim() ? `\nהערה: "${teacherReviewNote.trim()}"` : ""}\n\nזו ההערכה הישירה של המורה אחרי בדיקת הפתרון שהתלמיד הגיש. היא גוברת על נתונים שהתלמיד דיווח בעצמו, והיא מה שקובע איך "שליטה בחומר" מוגדרת אצל המורה הזה.`
    : "";

  const backgroundSection = backgroundNote?.trim()
    ? `\n## רקע קבוע על התלמיד (מה שהמורה כתב)\n${backgroundNote.trim()}`
    : "";

  const insightsSection = insights.length > 0
    ? `\n## מה עוזר לתלמיד הזה (${insights.length} תובנות מהמורה, מהחדש לישן)\n${insights
        .map((i) => `• ${i.content} (${new Date(i.created_at).toISOString().slice(0, 10)})`)
        .join("\n")}\n\nאלו תצפיות שהמורה צבר לאורך זמן. התובנות החדשות יותר משמעותיות יותר, והן מתארות איך התלמיד הזה לומד הכי טוב, הסיכום צריך לשקף אותן.`
    : "";

  return `עדכן את סיכום פרופיל הלמידה של תלמיד, לפי הביצוע שלו בשיעור האחרון.

## תלמיד: ${studentName}

## הסיכום הקיים
${currentSummary ?? "אין סיכום קיים, בנה אחד חדש."}

## שיעור אחרון: "${lessonTitle}"
- משימות שהושלמו: ${completedCount}
- משימות שנכשלו: ${failedCount}
- נושאים במשימות שנכשלו: ${failedTopics.join(", ") || "אין"}${reflectionSection}${teacherSection}${backgroundSection}${insightsSection}

כתוב סיכום מעודכן של 2 עד 4 משפטים, בגוף שלישי, על התלמיד, לפי שמו, שמכסה:
1. במה התלמיד חזק
2. במה הוא מתקשה
3. דפוסים בולטים או תצפיות על סגנון הלמידה שלו (תן משקל גבוה לרפלקציה של התלמיד עצמו אם יש כזו)

${HEBREW_WRITING_RULES}

כל שם נושא ב-strong_topics וב-weak_topics צריך להיות בעברית.

Respond ONLY with valid JSON:
{
  "ai_summary": "string (Hebrew)",
  "strong_topics": ["string (Hebrew)"],
  "weak_topics": ["string (Hebrew)"],
  "learning_style": "visual" | "step_by_step" | "example_first" | "theory_first" | "unknown"
}`;
}

// ─── Weekly progress report (teacher-facing) ──────────────────────────────
// Read only by the teacher — never rendered to the student (the student page
// shows a separate, purely structural derivation from the learning map, no
// LLM involved — see generate-report.ts). So this is written in third
// person, by the student's name, in an objective/analytical voice: the
// teacher is reading a report about their student, not being addressed
// personally. Facts sourced from the teacher's own notes/decisions are
// stated as facts ("בסקירת השיעור צוין ש..."), never as the teacher's own
// first-person voice ("ציינתי").
export function buildReportPrompt(params: {
  studentName: string;
  periodStart: string;
  periodEnd: string;
  totalLessons: number;
  completionRate: number;
  difficultyCount: number;
  difficulties: Array<{
    topicTags: string[];
    description: string | null;
    teacherNote: string | null;
  }>;
  lessonReviews: Array<{
    title: string;
    teacherDecision: string | null;
    teacherReviewNote: string | null;
    studentReflection: string | null;
  }>;
  insights: Array<{ content: string; created_at: string }>;
  backgroundNote: string | null;
  aiSummary: string | null;
  learningMap: {
    masteredTopics: string[];
    strugglingTopics: string[];
    inProgressTopics: string[];
  } | null;
  previousReports: Array<{
    periodEnd: string;
    completionRate: number | null;
    improve: string[];
  }>;
  studentTopics: {
    improve: string[];
    maintain: string[];
  };
}): string {
  const {
    studentName,
    periodStart,
    periodEnd,
    totalLessons,
    completionRate,
    difficultyCount,
    difficulties,
    lessonReviews,
    insights,
    backgroundNote,
    aiSummary,
    learningMap,
    previousReports,
    studentTopics,
  } = params;

  const difficultiesSection =
    difficulties.length > 0
      ? `\n## דיווחי קושי בתקופה (${difficulties.length})\n${difficulties
          .map((d) => {
            const tags = d.topicTags.join(", ") || "לא תויג";
            const parts = [`נושאים: ${tags}`];
            if (d.description?.trim()) parts.push(`תיאור: "${d.description.trim()}"`);
            if (d.teacherNote?.trim()) parts.push(`הערת מורה: "${d.teacherNote.trim()}"`);
            return `• ${parts.join(" | ")}`;
          })
          .join("\n")}`
      : "";

  const reviewsSection =
    lessonReviews.length > 0
      ? `\n## סקירות שיעורים בתקופה (${lessonReviews.length})\n${lessonReviews
          .map((r) => {
            const parts = [`שיעור: "${r.title}"`];
            if (r.teacherDecision)
              parts.push(`החלטת מורה: ${DECISION_LABEL[r.teacherDecision] ?? r.teacherDecision}`);
            if (r.teacherReviewNote?.trim())
              parts.push(`הערת מורה: "${r.teacherReviewNote.trim()}"`);
            if (r.studentReflection?.trim())
              parts.push(`רפלקציית תלמיד: "${r.studentReflection.trim()}"`);
            return `• ${parts.join(" | ")}`;
          })
          .join("\n")}`
      : "";

  const insightsSection =
    insights.length > 0
      ? `\n## תובנות שהמורה צבר על התלמיד (${insights.length})\n${insights
          .map((i) => `• ${i.content} (${new Date(i.created_at).toISOString().slice(0, 10)})`)
          .join("\n")}`
      : "";

  const backgroundSection = backgroundNote?.trim()
    ? `\n## רקע קבוע על התלמיד\n${backgroundNote.trim()}`
    : "";

  const learningMapSection = learningMap
    ? `\n## מצב מפת הלמידה (עדכני)\nנושאים שנשלטו: ${learningMap.masteredTopics.join(", ") || "אין"}\nנושאים בתהליך: ${learningMap.inProgressTopics.join(", ") || "אין"}\nנושאים בקושי: ${learningMap.strugglingTopics.join(", ") || "אין"}`
    : "";

  const trendSection =
    previousReports.length > 0
      ? `\n## דוחות קודמים לאותו תלמיד (${previousReports.length}, מהחדש לישן, לצורך זיהוי מגמה)\n${previousReports
          .map((r) => {
            const pct = r.completionRate !== null ? `${Math.round(r.completionRate * 100)}%` : "לא ידוע";
            const improve = r.improve.length > 0 ? r.improve.join(", ") : "אין";
            return `• עד ${r.periodEnd}, השלמה: ${pct}, נקודות לשיפור שעלו אז: ${improve}`;
          })
          .join("\n")}`
      : "\n## דוחות קודמים\nזהו הדוח הראשון לתלמיד הזה. אין נתוני מגמה קודמים.";

  return `אתה כותב דוח התקדמות שבועי שהמורה קורא על תלמיד שלו/שלה. הדוח נכתב בגוף שלישי, על התלמיד, לפי שמו, לא פנייה למורה ולא פנייה לתלמיד. עובדות שמקורן בהערות המורה מוצגות כעובדות אובייקטיביות ("בסקירת השיעור צוין ש...", "לפי מפת הלמידה..."), לעולם לא בגוף ראשון של המורה ("ציינתי").

## תלמיד: ${studentName}
## תקופה: ${periodStart} עד ${periodEnd}

## נתונים כמותיים
- שיעורים שהושלמו: ${totalLessons}
- אחוז השלמה כולל: ${(completionRate * 100).toFixed(0)}%
- דיווחי קושי: ${difficultyCount}
${difficultiesSection}${reviewsSection}${insightsSection}${backgroundSection}${learningMapSection}
${trendSection}

## פרופיל AI נוכחי
${aiSummary ?? "אין סיכום פרופיל זמין."}

## המשימה שלך
כתוב תקציר קצר וממוקד (2-4 משפטים) המבוסס על הנתונים שסופקו, לא על ניסוח גנרי של "התלמיד השלים X שיעורים". פתח בשם התלמיד. התבסס על הערות המורה, הרפלקציות של התלמיד, ומצב מפת הלמידה.

בנוסף, כתוב המלצות בשני חלקים (למורה בלבד, לא לתלמיד):
- "improve" (לשיפור): נקודות ספציפיות וקונקרטיות. כשהנתונים תומכים בכך, שלב בכל נקודה עד שלושה דברים: קצב ("בקצב הנוכחי..."), מגמה מול הדוחות הקודמים למעלה ("זה הנושא השלישי ברציפות שחוזר..." או "בניגוד לדוח הקודם..."), ופעולה קונקרטית לשיעור הבא ("בשיעור הבא כדאי להתחיל עם..."). אל תמציא מגמה אם אין דוחות קודמים, פשוט דלג על הזווית הזו.
- "maintain" (לשימור): מה עובד טוב ומומלץ להמשיך בו, גם כאן באופן ספציפי ולא גנרי.

כל טקסט חופשי (summary, improve, maintain) חייב להיות בעברית בלבד.

## משפט לתלמיד על כל נושא (student_notes)
בנפרד מהדוח למורה, התלמיד עצמו רואה רק רשימת נושאים פשוטה, בלי הפרטים הפרטיים שלמעלה. עבור כל נושא ברשימות הבאות, כתוב משפט אחד קצר, פונה ישירות לתלמיד בגוף שני ("אתה", לא "התלמיד"), שמלמד אותו משהו קונקרטי על הנושא הזה ומכוון אותו קדימה. אל תצטט או תפרש הערה פרטית של המורה כפי שהיא, רק תן לתלמיד תובנה לימודית בטוחה ושימושית שנובעת מהמידע.

נושאים לשיפור (סדר קבוע, משפט אחד לכל אחד): ${studentTopics.improve.join(", ") || "אין"}
נושאים לשימור (סדר קבוע, משפט אחד לכל אחד): ${studentTopics.maintain.join(", ") || "אין"}

אם אחת הרשימות ריקה, החזר עבורה מערך ריק. אחרת חובה משפט אחד בדיוק לכל נושא ברשימה, באותו סדר.

${HEBREW_WRITING_RULES}

Respond ONLY with valid JSON:
{
  "summary": "string (Hebrew)",
  "ai_recommendations": {
    "improve": ["string (Hebrew)"],
    "maintain": ["string (Hebrew)"],
    "suggested_difficulty": "easier" | "same" | "harder"
  },
  "student_notes": {
    "improve": ["string (Hebrew, one sentence per topic in studentTopics.improve, same order)"],
    "maintain": ["string (Hebrew, one sentence per topic in studentTopics.maintain, same order)"]
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

נושאים חזקים: ${params.strongTopics.join(", ") || "אין"}
נושאים חלשים: ${params.weakTopics.join(", ") || "אין"}

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
כתוב כרטיס הכנה קצר למורה, 3 עד 4 שורות בעברית, בולטים. ענה על:
1. איפה עצרנו (נושא + החלטה)
2. מה היה קשה לתלמיד
3. על מה להתמקד היום
4. טיפ אישי אחד מהרקע או מהתובנות (אם רלוונטי)

אל תכתוב מבוא או סיכום. רק 3 עד 4 בולטים קצרים, בלשון פנייה למורה ("התלמיד התקשה...", "מומלץ להתחיל ב...").

${HEBREW_WRITING_RULES}

Respond ONLY with valid JSON:
{
  "briefing": "string (Hebrew, 3-4 short bullets separated by \\n)"
}`;
}

