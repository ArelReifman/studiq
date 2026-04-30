-- Migration: add 'cancel_requested' value to booking_status enum.
-- Idempotent. Used when a student cancels an already-approved lesson — the
-- request goes to the teacher's approvals queue instead of cancelling outright.

ALTER TYPE "public"."booking_status" ADD VALUE IF NOT EXISTS 'cancel_requested';
