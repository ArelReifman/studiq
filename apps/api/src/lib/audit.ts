import type { Context } from "hono";
import { db } from "../db/client.js";
import { auditLogs } from "../db/schema.js";

export type AuditEvent =
  | "auth.login_failed"
  | "auth.register_failed"
  | "auth.password_reset_requested"
  | "authz.forbidden"
  | "approvals.student_approved"
  | "approvals.student_rejected"
  | "rate_limit.blocked";

interface AuditInput {
  event: AuditEvent;
  actor_id?: string | null;
  target_id?: string | null;
  actor_email?: string | null;
  ip?: string | null;
  path?: string | null;
  method?: string | null;
  detail?: Record<string, unknown>;
}

function getClientIp(c: Context): string | null {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    c.req.header("cf-connecting-ip") ??
    null
  );
}

/**
 * Record a security event. Best-effort: failures are logged but never thrown,
 * so the underlying request flow is never blocked by audit-log issues.
 */
export async function audit(c: Context, input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      event: input.event,
      actor_id: input.actor_id ?? (c.get("userId") as string | undefined) ?? null,
      target_id: input.target_id ?? null,
      actor_email: input.actor_email ?? null,
      ip: input.ip ?? getClientIp(c),
      path: input.path ?? c.req.path,
      method: input.method ?? c.req.method,
      detail: input.detail ?? null,
    });
  } catch (err) {
    console.error("[audit] insert failed:", (err as Error).message);
  }
}
