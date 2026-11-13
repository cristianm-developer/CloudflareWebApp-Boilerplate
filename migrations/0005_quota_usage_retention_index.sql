-- Keep the 90-day scheduled cleanup efficient without changing the original quota migration.
DROP INDEX IF EXISTS idx_tenant_quota_usage_window_end;

CREATE INDEX IF NOT EXISTS idx_tenant_quota_usage_window_end
  ON tenant_quota_usage(window_end);
