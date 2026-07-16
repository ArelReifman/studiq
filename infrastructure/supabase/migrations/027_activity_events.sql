-- Activity events: append-only usage-analytics log (student logins, lesson
-- opens, learning-map opens). Distinct from audit_logs (a security event
-- trail) — this table is for routine usage counts, not security auditing.
-- RLS denies all client access — writes and reads happen only via the API
-- service role (the /admin-analytics/overview endpoint).

CREATE TYPE activity_event_type AS ENUM (
  'auth.login_succeeded',
  'lesson.opened',
  'learning_map.opened'
);

CREATE TABLE activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type activity_event_type NOT NULL,
  -- No FK to students — a logging insert must never fail due to a foreign
  -- key violation on a code path we don't fully control.
  student_id UUID,
  actor_id UUID,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_events_student_created ON activity_events(student_id, created_at);
CREATE INDEX idx_activity_events_type_created ON activity_events(event_type, created_at);

ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;
-- No policies = no client access. Service role bypasses RLS for inserts/reads.
