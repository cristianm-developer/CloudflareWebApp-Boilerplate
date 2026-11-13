CREATE TABLE IF NOT EXISTS billing_plans (
  plan_key TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  rank INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS billing_plan_quotas (
  plan_key TEXT NOT NULL REFERENCES billing_plans(plan_key) ON DELETE CASCADE,
  quota_key TEXT NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly')),
  limit_value INTEGER CHECK (limit_value IS NULL OR limit_value >= 0),
  PRIMARY KEY (plan_key, quota_key)
);

CREATE TABLE IF NOT EXISTS billing_products (
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'google-play')),
  product_id TEXT NOT NULL,
  plan_key TEXT NOT NULL REFERENCES billing_plans(plan_key),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  PRIMARY KEY (provider, product_id)
);

CREATE TABLE IF NOT EXISTS billing_customers (
  provider TEXT NOT NULL CHECK (provider = 'stripe'),
  provider_customer_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, provider_customer_id),
  UNIQUE (provider, tenant_id)
);

CREATE TABLE IF NOT EXISTS billing_entitlements (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'google-play')),
  provider_reference TEXT NOT NULL,
  plan_key TEXT NOT NULL REFERENCES billing_plans(plan_key),
  status TEXT NOT NULL CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'expired', 'revoked', 'pending')),
  current_period_end TEXT,
  provider_event_created INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, provider, provider_reference)
);

CREATE INDEX IF NOT EXISTS idx_billing_entitlements_tenant_status
  ON billing_entitlements(tenant_id, status, current_period_end);

CREATE TABLE IF NOT EXISTS billing_google_play_purchases (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  plan_key TEXT NOT NULL REFERENCES billing_plans(plan_key),
  expiry_time TEXT,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS billing_stripe_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS billing_google_play_notifications (
  message_id TEXT PRIMARY KEY NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Quota policies written from the active plan are reconciled without deleting
-- manual/add-on policies maintained by a trusted admin or project module.
ALTER TABLE tenant_quota_policies
  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
