-- Audit log: append-only record of security-relevant events.
-- RLS denies all client access — writes happen only via the API service role,
-- and reads are intended for ops/SQL console, not the app UI.

CREATE TYPE audit_event AS ENUM (
  'auth.login_failed',
  'auth.register_failed',
  'auth.password_reset_requested',
  'authz.forbidden',
  'approvals.student_approved',
  'approvals.student_rejected',
  'rate_limit.blocked'
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event audit_event NOT NULL,
  actor_id UUID,
  target_id UUID,
  actor_email TEXT,
  ip TEXT,
  path TEXT,
  method TEXT,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_event ON audit_logs(event);
CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
-- No policies = no client access. Service role bypasses RLS for inserts/reads.
