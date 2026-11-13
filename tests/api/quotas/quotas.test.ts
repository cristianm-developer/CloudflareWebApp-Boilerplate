import { describe, expect, it, vi } from 'vitest';
import { consumeQuota, quotaWindowFor } from '../../../api/modules/quotas';

const tenant = { tenantId: 'tenant-1' } as never;

describe('quotaWindowFor', () => {
  it('uses UTC midnight for daily windows', () => {
    expect(quotaWindowFor('daily', new Date('2026-07-09T23:59:59.000Z'))).toEqual({
      start: '2026-07-09T00:00:00.000Z',
      end: '2026-07-10T00:00:00.000Z',
    });
  });

  it('uses Monday-start weeks across month and year boundaries', () => {
    expect(quotaWindowFor('weekly', new Date('2026-01-04T12:00:00.000Z'))).toEqual({
      start: '2025-12-29T00:00:00.000Z',
      end: '2026-01-05T00:00:00.000Z',
    });
  });

  it('handles leap-year monthly windows', () => {
    expect(quotaWindowFor('monthly', new Date('2024-02-29T23:59:00.000Z'))).toEqual({
      start: '2024-02-01T00:00:00.000Z',
      end: '2024-03-01T00:00:00.000Z',
    });
  });
});

describe('consumeQuota', () => {
  it('fails closed when no tenant policy exists', async () => {
    const statement = { bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue(null) };
    const db = { prepare: vi.fn(() => statement) } as never;
    await expect(consumeQuota(db, tenant, 'ai.requests')).resolves.toMatchObject({
      allowed: false,
      limit: 0,
      used: 0,
      remaining: 0,
      reason: 'not_configured',
    });
  });

  it('rejects invalid usage amounts before touching D1', async () => {
    const db = { prepare: vi.fn() } as never;
    await expect(consumeQuota(db, tenant, 'ai.requests', 0)).rejects.toThrow('positive safe integer');
    await expect(consumeQuota(db, tenant, 'ai.requests', Number.MAX_SAFE_INTEGER + 1)).rejects.toThrow('positive safe integer');
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('reserves bounded usage atomically and reports the current usage on denial', async () => {
    const sql: string[] = [];
    const db = {
      prepare: vi.fn((query: string) => {
        sql.push(query);
        return {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(query.includes('SELECT period')
            ? { period: 'daily', limit_value: 2 }
            : query.includes('INSERT INTO tenant_quota_usage') ? null : { used: 2 }),
        };
      }),
    } as never;

    await expect(consumeQuota(db, tenant, 'ai.requests', 1, new Date('2026-07-09T12:00:00.000Z'))).resolves.toMatchObject({
      allowed: false,
      limit: 2,
      used: 2,
      remaining: 0,
      reason: 'limit_reached',
    });
    expect(sql[1]).toContain('tenant_quota_usage.used + excluded.used <= ?');
  });

  it('increments unlimited quota usage without imposing a cap', async () => {
    const db = {
      prepare: vi.fn((query: string) => ({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(query.includes('SELECT period')
          ? { period: 'monthly', limit_value: null }
          : { used: 3 }),
      })),
    } as never;
    await expect(consumeQuota(db, tenant, 'ai.requests', 3)).resolves.toMatchObject({
      allowed: true,
      limit: null,
      used: 3,
      remaining: null,
    });
  });
});
