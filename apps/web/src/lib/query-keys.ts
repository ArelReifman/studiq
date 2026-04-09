export const qk = {
  // Student
  lessons: () => ["lessons"] as const,
  lesson: (id: string) => ["lessons", id] as const,
  homework: (lessonId: string) => ["homework", lessonId] as const,
  todos: (lessonId: string) => ["todos", lessonId] as const,
  difficulties: () => ["difficulties"] as const,
  reports: () => ["reports"] as const,

  // Teacher
  students: () => ["students"] as const,
  student: (id: string) => ["students", id] as const,
  studentProfile: (id: string) => ["students", id, "profile"] as const,
  studentReport: (id: string) => ["students", id, "report"] as const,
  studentLessons: (id: string) => ["lessons", { student_id: id }] as const,
  studentDifficulties: (id: string) =>
    ["difficulties", { student_id: id }] as const,
  aiFeedback: (studentId?: string) =>
    studentId ? ["ai-feedback", studentId] : (["ai-feedback"] as const),
};
