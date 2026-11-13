import { describe, expect, it, vi } from 'vitest';
import { rateLimit } from '../../../api/middleware/rate-limit';

function contextFor(path: string, limit: ReturnType<typeof vi.fn>) {
  return {
    env: { APP_ENV: 'stage', API_RATE_LIMITER: { limit } },
    req: {
      path,
      header: (name: string) => name === 'cf-connecting-ip' ? '203.0.113.8' : undefined,
    },
    json: vi.fn((_body: unknown, status = 200) => new Response(null, { status })),
    header: vi.fn(),
  };
}

describe('rateLimit', () => {
  it('shares an IP bucket across paths instead of allowing path rotation', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    const middleware = rateLimit('API_RATE_LIMITER');
    const next = vi.fn();
    const first = contextFor('/api/tenant/a', limit);
    const second = contextFor('/api/tenant/b', limit);

    await middleware(first as never, next);
    await middleware(second as never, next);

    expect(limit.mock.calls.map(([input]) => input.key)).toEqual([
      'stage:API_RATE_LIMITER:203.0.113.8',
      'stage:API_RATE_LIMITER:203.0.113.8',
    ]);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the rate-limit binding is absent', async () => {
    const middleware = rateLimit('API_RATE_LIMITER');
    const context = contextFor('/api/health', vi.fn());
    context.env.API_RATE_LIMITER = undefined as never;

    await middleware(context as never, vi.fn());
    expect(context.json).toHaveBeenCalledWith({ error: 'Rate limiting is not configured' }, 503);
  });

  it('returns 429 and Retry-After when the binding rejects a request', async () => {
    const limiter = vi.fn().mockResolvedValue({ success: false });
    const context = contextFor('/api/auth/login', limiter);

    await rateLimit('API_RATE_LIMITER')(context as never, vi.fn());
    expect(context.header).toHaveBeenCalledWith('Retry-After', '60');
    expect(context.json).toHaveBeenCalledWith({ error: 'Too many requests' }, 429);
  });
});
