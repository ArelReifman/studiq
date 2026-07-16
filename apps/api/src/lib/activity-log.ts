import type { Context } from "hono";
import { db } from "../db/client.js";
import { activityEvents } from "../db/schema.js";

export type ActivityEventType =
  | "auth.login_succeeded"
  | "lesson.opened"
  | "learning_map.opened";

interface ActivityInput {
  event_type: ActivityEventType;
  student_id?: string | null;
  actor_id?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Record a usage-analytics event. Fire-and-forget by design: the promise is
 * intentionally not returned/awaited by callers, so a slow or failing insert
 * can never delay or break the underlying request/response.
 */
export function logActivity(_c: Context, input: ActivityInput): void {
  db.insert(activityEvents)
    .values({
      event_type: input.event_type,
      student_id: input.student_id ?? null,
      actor_id: input.actor_id ?? null,
      detail: input.detail ?? null,
    })
    .catch((err) => {
      console.error("[activity-log] insert failed:", (err as Error).message);
    });
}
