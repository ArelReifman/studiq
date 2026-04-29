-- Migration: per-date teacher availability
-- Switches teacher_availability from recurring (day_of_week) to specific dates.
-- Safe & idempotent. Old rows with only day_of_week still work; new rows use `date`.

-- Add the date column
ALTER TABLE "teacher_availability"
  ADD COLUMN IF NOT EXISTS "date" date;

-- Make day_of_week nullable (was NOT NULL)
ALTER TABLE "teacher_availability"
  ALTER COLUMN "day_of_week" DROP NOT NULL;

-- Index for fast per-date lookups
CREATE INDEX IF NOT EXISTS "idx_teacher_availability_date"
  ON "teacher_availability" ("date");

-- Optional cleanup: hide legacy recurring slots from the new UI by deactivating them.
-- Comment out if you want to keep them visible.
UPDATE "teacher_availability"
  SET "is_active" = false
  WHERE "date" IS NULL AND "day_of_week" IS NOT NULL;
