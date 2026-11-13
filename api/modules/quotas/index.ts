import type { ActiveTenantContext } from '../tenants';
import { quotaKeySchema, type QuotaPeriod } from '@boilerplate/contracts';

export interface QuotaWindow {
  start: string;
  end: string;
}

export interface QuotaResult {
  allowed: boolean;
  quotaKey: string;
  period?: QuotaPeriod;
  limit: number | null;
  used: number;
  remaining: number | null;
  resetsAt?: string;
  reason?: 'not_configured' | 'limit_reached';
}

interface QuotaPolicyRow {
  period: QuotaPeriod;
  limit_value: number | null;
}

interface QuotaUsageRow {
  used: number;
}

export const QUOTA_USAGE_RETENTION_DAYS = 90;
const QUOTA_USAGE_PURGE_BATCH_SIZE = 1_000;
const QUOTA_USAGE_PURGE_MAX_BATCHES = 10;

/** UTC calendar windows: day, Monday-start week, or calendar month. */
export function quotaWindowFor(period: QuotaPeriod, now = new Date()): QuotaWindow {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let end: Date;

  if (period === 'daily') {
    end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  } else if (period === 'weekly') {
    const daysSinceMonday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - daysSinceMonday);
    end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  } else {
    start.setUTCDate(1);
    end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  }

  return { start: start.toISOString(), end: end.toISOString() };
}

/** Atomically reserves a tenant's metered product usage. Missing policy fails closed. */
export async function consumeQuota(
  db: D1Database,
  tenant: ActiveTenantContext,
  quotaKey: string,
  amount = 1,
  now = new Date(),
): Promise<QuotaResult> {
  if (!quotaKeySchema.safeParse(quotaKey).success) throw new Error('Invalid quota key');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Quota amount must be a positive safe integer');

  const policy = await db
    .prepare('SELECT period, limit_value FROM tenant_quota_policies WHERE tenant_id = ? AND quota_key = ?')
    .bind(tenant.tenantId, quotaKey)
    .first<QuotaPolicyRow>();

  if (!policy) {
    return { allowed: false, quotaKey, limit: 0, used: 0, remaining: 0, reason: 'not_configured' };
  }

  const window = quotaWindowFor(policy.period, now);
  if (policy.limit_value === null) {
    const usage = await db.prepare(`
      INSERT INTO tenant_quota_usage (tenant_id, quota_key, window_start, window_end, used)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, quota_key, window_start) DO UPDATE SET
        used = tenant_quota_usage.used + excluded.used,
        window_end = excluded.window_end,
        updated_at = datetime('now')
      RETURNING used
    `).bind(tenant.tenantId, quotaKey, window.start, window.end, amount).first<QuotaUsageRow>();

    return {
      allowed: true,
      quotaKey,
      period: policy.period,
      limit: null,
      used: usage?.used ?? amount,
      remaining: null,
      resetsAt: window.end,
    };
  }

  const result = await db.prepare(`
    INSERT INTO tenant_quota_usage (tenant_id, quota_key, window_start, window_end, used)
    SELECT ?, ?, ?, ?, ?
    WHERE ? <= ?
    ON CONFLICT (tenant_id, quota_key, window_start) DO UPDATE SET
      used = tenant_quota_usage.used + excluded.used,
      window_end = excluded.window_end,
      updated_at = datetime('now')
    WHERE tenant_quota_usage.used + excluded.used <= ?
    RETURNING used
  `).bind(
    tenant.tenantId,
    quotaKey,
    window.start,
    window.end,
    amount,
    amount,
    policy.limit_value,
    policy.limit_value,
  ).first<QuotaUsageRow>();

  const usage = result ?? await db
    .prepare('SELECT used FROM tenant_quota_usage WHERE tenant_id = ? AND quota_key = ? AND window_start = ?')
    .bind(tenant.tenantId, quotaKey, window.start)
    .first<QuotaUsageRow>();
  const used = usage?.used ?? 0;
  const allowed = result !== null;

  return {
    allowed,
    quotaKey,
    period: policy.period,
    limit: policy.limit_value,
    used,
    remaining: Math.max(0, policy.limit_value - used),
    resetsAt: window.end,
    ...(allowed ? {} : { reason: 'limit_reached' as const }),
  };
}

/** Remove quota counters only after their usage window has ended and aged out. */
export async function purgeExpiredQuotaUsage(
  db: D1Database,
  now = new Date(),
): Promise<{ deleted: number; cutoff: string }> {
  const cutoff = new Date(now.getTime() - QUOTA_USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let deleted = 0;

  for (let batch = 0; batch < QUOTA_USAGE_PURGE_MAX_BATCHES; batch += 1) {
    const result = await db.prepare(`
      DELETE FROM tenant_quota_usage
      WHERE rowid IN (
        SELECT rowid
        FROM tenant_quota_usage
        WHERE window_end <= ?
        LIMIT ?
      )
    `).bind(cutoff, QUOTA_USAGE_PURGE_BATCH_SIZE).run();
    const changes = result.meta?.changes ?? 0;
    deleted += changes;

    if (changes < QUOTA_USAGE_PURGE_BATCH_SIZE) break;
  }

  return { deleted, cutoff };
}
