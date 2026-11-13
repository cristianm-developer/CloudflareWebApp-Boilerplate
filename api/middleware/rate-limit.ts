import type { MiddlewareHandler } from 'hono';
import type { WorkerEnv } from '../env';

type RateLimitBindings = 'API_RATE_LIMITER' | 'AUTH_RATE_LIMITER';

export function rateLimit(binding: RateLimitBindings): MiddlewareHandler<{ Bindings: WorkerEnv }> {
  return async (context, next) => {
    const limiter = context.env[binding];
    if (!limiter) return context.json({ error: 'Rate limiting is not configured' }, 503);

    const address = context.req.header('cf-connecting-ip') ?? 'local';
    const key = `${context.env.APP_ENV}:${binding}:${address}`;
    const result = await limiter.limit({ key });
    if (!result.success) {
      context.header('Retry-After', '60');
      return context.json({ error: 'Too many requests' }, 429);
    }
    await next();
  };
}
