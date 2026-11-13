-- Product quotas are separate from Cloudflare request rate limits.
-- Policies are the effective limits after plan/add-on resolution.
CREATE TABLE IF NOT EXISTS tenant_quota_policies (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quota_key TEXT NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly')),
  limit_value INTEGER CHECK (limit_value IS NULL OR limit_value >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, quota_key)
);

CREATE TABLE IF NOT EXISTS tenant_quota_usage (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quota_key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  used INTEGER NOT NULL CHECK (used >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, quota_key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_tenant_quota_usage_window_end
  ON tenant_quota_usage(tenant_id, window_end);
