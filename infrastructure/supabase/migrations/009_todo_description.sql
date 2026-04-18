-- Unify tasks: give todo_items a description so it can replace homework_items.
-- Existing homework rows remain readable in legacy lessons; new lessons only
-- create todo_items from here on.

ALTER TABLE todo_items
  ADD COLUMN IF NOT EXISTS description text;
