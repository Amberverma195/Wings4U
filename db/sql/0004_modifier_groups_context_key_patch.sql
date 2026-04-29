-- 0004_modifier_groups_context_key_patch.sql
-- Run ONCE against an existing database that is missing modifier_groups.context_key
-- but is otherwise using the current application/schema expectations.

ALTER TABLE modifier_groups
  ADD COLUMN IF NOT EXISTS context_key text;
