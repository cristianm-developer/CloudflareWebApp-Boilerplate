import { Hono } from 'hono';
import { z } from 'zod';
import type { WorkerEnv } from './env';
import { rateLimit } from './middleware/rate-limit';
import { createAuthHandler } from './modules/auth';
import { adminRoutes } from './modules/admin';
import { billingRoutes } from './modules/billing';
import { tenantContextMiddleware, tenantContextRoutes, requireTenantPermission, type TenantHonoEnv } from './modules/tenants';

const healthResponse = z.object({
  ok: z.literal(true),
  environment: z.string(),
});

export const api = new Hono<{ Bindings: WorkerEnv }>();

api.use('*', rateLimit('API_RATE_LIMITER'));
api.use('/api/auth/*', rateLimit('AUTH_RATE_LIMITER'));

api.on(['GET', 'POST'], '/api/auth/*', (context) =>
  createAuthHandler(context.env)(context.req.raw),
);

api.route('/api/tenants', tenantContextRoutes);

const tenantAdminApi = new Hono<TenantHonoEnv>();
tenantAdminApi.use('*', tenantContextMiddleware());
tenantAdminApi.route('/', adminRoutes);
api.route('/api/admin', tenantAdminApi);

api.route('/api/billing', billingRoutes);

const tenantApi = new Hono<TenantHonoEnv>();
tenantApi.use('*', tenantContextMiddleware());
tenantApi.get('/context', requireTenantPermission('tenant.read'), (context) => {
  const tenant = context.get('tenantContext');
  return context.json({
    tenant: { id: tenant.tenantId, key: tenant.key, role: tenant.role },
    permissions: tenant.permissions,
  });
});
api.route('/api/tenant', tenantApi);

api.get('/api/health', (context) => {
  const body = healthResponse.parse({
    ok: true,
    environment: context.env?.APP_ENV ?? 'development',
  });
  return context.json(body);
});

api.notFound((context) => context.json({ error: 'API route not found' }, 404));
