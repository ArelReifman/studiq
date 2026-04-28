-- Migration: add approval gate to profiles
-- Safe & idempotent. Existing rows default to 'approved' so nothing breaks.

DO $$ BEGIN
  CREATE TYPE "public"."profile_status" AS ENUM('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "status" "public"."profile_status" NOT NULL DEFAULT 'approved';

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "approved_by" uuid;

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "rejected_at" timestamp with time zone;

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "signup_note" text;

-- Index for the teacher approvals page
CREATE INDEX IF NOT EXISTS "idx_profiles_status_pending"
  ON "profiles" ("created_at" DESC)
  WHERE "status" = 'pending';
