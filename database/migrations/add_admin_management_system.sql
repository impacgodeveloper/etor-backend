-- ============================================================
-- Admin Management: Roles & Permissions + Configuration
-- ============================================================
-- Additive only. Nothing here renames, drops, or changes the meaning
-- of any existing column/table, and no tenant business data is touched.
--
-- The "Users" tab needs NO new table — it's wired directly onto the
-- existing public.admin_users (tenant admins), same as the
-- Organizations tab. This file only adds the two tables backing the
-- Roles & Permissions and Configuration tabs, which had no backend at
-- all before now (they ran on in-memory mock data in the Flutter app).
--
-- Both tables are seeded with the exact same values the mock data used
-- to return, so switching a screen from mock to real data changes
-- nothing about what the Super Admin sees until they actually edit
-- something.
--
-- Run this once against the same Postgres database described by
-- farmiq.txt / database/schema.sql (Supabase SQL editor or psql).
-- ============================================================

-- ------------------------------------------------------------
-- 1. platform_roles — one row per role, permissions as a plain
--    string array (matches the fixed 7-item permission catalog the
--    Flutter app already defines in kAllPermissions; not a separate
--    normalized permissions table, since nothing today needs to query
--    "which roles hold permission X" independently of a specific role).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_roles (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  permissions TEXT[] NOT NULL DEFAULT '{}',
  user_count INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_roles_pkey PRIMARY KEY (id)
) TABLESPACE pg_default;

INSERT INTO public.platform_roles (id, name, description, permissions, user_count, sort_order) VALUES
  ('super_admin', 'Super Admin', 'Full access across all organizations and system settings.',
    ARRAY['Manage Users','Manage Organizations','Manage Roles & Permissions','Manage Billing & Subscriptions','Manage Farm Data','View Reports','System Configuration'], 1, 1),
  ('org_admin', 'Org Admin', 'Manages users, farm data and billing within their own organization.',
    ARRAY['Manage Users','Manage Farm Data','View Reports','Manage Billing & Subscriptions'], 3, 2),
  ('agronomist', 'Agronomist', 'Manages farm & yield data, no user or billing access.',
    ARRAY['Manage Farm Data','View Reports'], 2, 3),
  ('viewer', 'Viewer', 'Read-only access to reports and dashboards.',
    ARRAY['View Reports'], 2, 4)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 2. platform_settings — generic key/value rows, one per configuration
--    item, matching the AdminConfigItem shape the Configuration tab
--    already renders (key, label, description, is_toggle, value, enabled).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_toggle BOOLEAN NOT NULL DEFAULT false,
  value TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_settings_pkey PRIMARY KEY (key)
) TABLESPACE pg_default;

INSERT INTO public.platform_settings (key, label, description, is_toggle, value, enabled, sort_order) VALUES
  ('platform_name', 'Platform Name', 'Shown in emails and the browser tab title.', false, 'FarmYieldIQ Admin', false, 1),
  ('support_email', 'Support Email', 'Displayed to admins for help requests.', false, 'support@farmyieldiq.com', false, 2),
  ('session_timeout', 'Session Timeout (minutes)', 'How long an idle admin session stays signed in.', false, '30', false, 3),
  ('require_mfa', 'Require MFA for Admins', 'Require a second factor for all admin & org-admin accounts.', true, '', true, 4),
  ('allow_self_signup', 'Allow Self-Service Signup', 'Let new organizations register from the public signup page.', true, '', true, 5),
  ('maintenance_mode', 'Maintenance Mode', 'Temporarily block admin sign-ins during maintenance.', true, '', false, 6)
ON CONFLICT (key) DO NOTHING;
