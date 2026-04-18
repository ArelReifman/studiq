-- Add parent_topic_id to course_topics so topics can be organised as
-- parent → children (2 levels: root topic → sub-topics).
-- NULL = top-level topic.  Deleting a parent sets children's parent_id to NULL.

ALTER TABLE course_topics
  ADD COLUMN IF NOT EXISTS parent_topic_id uuid
    REFERENCES course_topics(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_course_topics_parent_id
  ON course_topics(parent_topic_id);
