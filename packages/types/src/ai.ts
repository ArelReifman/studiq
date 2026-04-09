// Schemas for Claude structured output (validated with Zod on the API side)

export interface AiHomeworkItem {
  title: string;
  description: string;
  order_index: number;
}

export interface AiTodoItem {
  title: string;
  order_index: number;
}

export interface AiGeneratedLesson {
  title: string;
  description: string;
  homework_items: AiHomeworkItem[];
  todo_items: AiTodoItem[];
}

export interface AiDifficultyTag {
  topic_tags: string[];
  confidence: number; // 0-1
}

export interface AiProfileUpdate {
  strong_topics: string[];
  weak_topics: string[];
  learning_style: string;
  ai_summary: string;
}

export interface AiReportSummary {
  summary: string;
  ai_recommendations: {
    focus_topics: string[];
    suggested_difficulty: "easier" | "same" | "harder";
    notes: string;
  };
}
