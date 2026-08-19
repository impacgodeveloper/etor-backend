-- ============================================================
-- Trial Management & Trial Expiry Notification System
-- ============================================================
-- Additive only. Nothing here renames, drops, or changes the
-- meaning of any existing column, and no existing business data
-- (partners, plots, cows, etc., in any tenant schema) is touched.
--
-- Reuses what already exists on public.admin_users (the one-row-
-- per-tenant registry): trial_ends_at, is_subscribed. This just
-- adds the handful of columns/tables needed to (a) know when a
-- trial *started* and how many times it's been extended, (b) give
-- the org a real display name (currently thrown away at signup —
-- only the slugified tenant_schema survives), (c) record a genuine
-- platform Super Admin identity distinct from tenant admins, and
-- (d) persist notification/audit history for the Super Admin UI.
--
-- Run this once against the same Postgres database described by
-- farmiq.txt / database/schema.sql (Supabase SQL editor or psql).
-- ============================================================

-- ------------------------------------------------------------
-- 1. admin_users: trial lifecycle + display name
-- ------------------------------------------------------------
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS trial_extension_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upgraded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS organization_name TEXT;

-- Backfill trial_started_at for existing + newly-altered rows: every
-- tenant's trial actually started at signup (created_at). Unconditional
-- (not "WHERE trial_started_at IS NULL") for the same reason called out
-- in add_trial_expiry.sql: a non-constant default can't be applied by
-- ALTER TABLE, so this column comes in NULL for every existing row.
UPDATE public.admin_users
SET trial_started_at = created_at
WHERE trial_started_at IS NULL;

ALTER TABLE public.admin_users
  ALTER COLUMN trial_started_at SET DEFAULT now(),
  ALTER COLUMN trial_started_at SET NOT NULL;

-- ------------------------------------------------------------
-- 2. platform_admins: the REAL Super Admin identity
-- ------------------------------------------------------------
-- public.admin_users is the tenant registry (one row per organization);
-- it is not a place to also store ImpacGo's own platform staff. This is
-- a separate, small table so "Super Admin access must continue [after a
-- tenant's trial expires]" is true by construction — platform_admins
-- rows are never subject to any tenant's trial_ends_at/is_subscribed
-- gate, because the two tables (and the auth middleware guarding them)
-- are completely independent.
CREATE TABLE IF NOT EXISTS public.platform_admins (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  email TEXT NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_admins_pkey PRIMARY KEY (id),
  CONSTRAINT platform_admins_email_key UNIQUE (email)
) TABLESPACE pg_default;

-- ------------------------------------------------------------
-- 3. trial_notifications: persisted log of every reminder/expiry/
--    extend/renew/upgrade notice, so the Super Admin app can show a
--    real history instead of "fire and forget" emails, and so the
--    daily cron can never send the same notice twice for the same day.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trial_notifications (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  admin_user_id UUID NOT NULL,
  notif_type TEXT NOT NULL,
  notif_date DATE NOT NULL DEFAULT CURRENT_DATE,
  channel TEXT NOT NULL DEFAULT 'email',
  days_left INTEGER,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trial_notifications_pkey PRIMARY KEY (id),
  CONSTRAINT trial_notifications_admin_user_id_fkey
    FOREIGN KEY (admin_user_id) REFERENCES public.admin_users (id) ON DELETE CASCADE,
  CONSTRAINT trial_notifications_type_check CHECK (
    notif_type = ANY (ARRAY[
      'trial_reminder'::text,
      'trial_expired'::text,
      'trial_extended'::text,
      'trial_renewed'::text,
      'trial_upgraded'::text
    ])
  ),
  -- Idempotency guard: the cron can run/retry any number of times a day
  -- without ever double-sending the same notice to the same tenant.
  CONSTRAINT trial_notifications_unique_per_day
    UNIQUE (admin_user_id, notif_type, notif_date)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_trial_notifications_admin_user
  ON public.trial_notifications USING btree (admin_user_id) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_trial_notifications_date
  ON public.trial_notifications USING btree (notif_date DESC) TABLESPACE pg_default;

-- ------------------------------------------------------------
-- 4. trial_audit_log: every trial/subscription state change, who did it
--    (a platform admin, or "system" for the automated expiry detector),
--    and the before/after values — for the Super Admin's audit trail.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trial_audit_log (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  admin_user_id UUID NOT NULL,
  action TEXT NOT NULL,
  performed_by UUID,
  performed_by_name TEXT,
  previous_state JSONB,
  new_state JSONB,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trial_audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT trial_audit_log_admin_user_id_fkey
    FOREIGN KEY (admin_user_id) REFERENCES public.admin_users (id) ON DELETE CASCADE,
  CONSTRAINT trial_audit_log_performed_by_fkey
    FOREIGN KEY (performed_by) REFERENCES public.platform_admins (id) ON DELETE SET NULL,
  CONSTRAINT trial_audit_log_action_check CHECK (
    action = ANY (ARRAY[
      'tenant_created'::text,
      'trial_extended'::text,
      'trial_renewed'::text,
      'trial_upgraded'::text,
      'trial_expired_detected'::text,
      'tenant_activated'::text,
      'tenant_suspended'::text
    ])
  )
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_trial_audit_log_admin_user
  ON public.trial_audit_log USING btree (admin_user_id) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_trial_audit_log_created
  ON public.trial_audit_log USING btree (created_at DESC) TABLESPACE pg_default;

-- ------------------------------------------------------------
-- 5. notification_settings: the "configurable" part of the notification
--    scheduler (reminder lead time, whether the expiry-day notice fires).
--    Singleton row (id is always 1) — Super Admin edits it in place.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_settings (
  id SMALLINT NOT NULL DEFAULT 1,
  reminder_days_before INTEGER NOT NULL DEFAULT 3,
  notify_on_expiry_day BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_settings_pkey PRIMARY KEY (id),
  CONSTRAINT notification_settings_singleton CHECK (id = 1)
) TABLESPACE pg_default;

INSERT INTO public.notification_settings (id, reminder_days_before, notify_on_expiry_day)
VALUES (1, 3, true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Day-to-day operations reference (same spirit as add_trial_expiry.sql):
-- ============================================================
-- Create the first real platform Super Admin (bcrypt-hash the password
-- first — see etor-backend-main/seedPlatformAdmin.js for a script that
-- does this for you):
--   INSERT INTO public.platform_admins (email, password, name)
--   VALUES ('superadmin@farmyieldiq.com', '<bcrypt-hash>', 'Super Admin');
--
-- Everything else (extend/renew/upgrade a tenant, list who's expiring)
-- now goes through the /api/platform/tenants/* endpoints instead of
-- hand-written SQL, so the audit log and notification history stay
-- accurate.
