import { Hono } from 'hono';
import { z } from 'zod';
import { requireTenantPermission, type TenantHonoEnv } from '../tenants';
import { buildConfigurationHealthReport } from './config-health';

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const membershipUpdateSchema = z.object({
  role: z.enum(['admin', 'member', 'viewer']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
}).strict().refine((value) => value.role !== undefined || value.status !== undefined);
const tenantUpdateSchema = z.object({ name: z.string().trim().min(2).max(100) }).strict();

export const adminRoutes = new Hono<TenantHonoEnv>();
adminRoutes.use('*', requireTenantPermission('admin.manage'));

adminRoutes.get('/health', (context) => {
  return context.json(buildConfigurationHealthReport(context.env));
});

adminRoutes.get('/tenant', async (context) => {
  const tenant = context.get('tenantContext');
  try {
    const row = await context.env.DB.prepare(`
      SELECT t.id, t.name, t.slug, t.kind, t.status, t.created_at,
        COUNT(m.id) AS member_count,
        COALESCE(SUM(CASE WHEN m.status = 'active' THEN 1 ELSE 0 END), 0) AS active_member_count
      FROM tenants t
      LEFT JOIN tenant_memberships m ON m.tenant_id = t.id
      WHERE t.id = ?
      GROUP BY t.id
    `).bind(tenant.tenantId).first();
    if (!row) return context.json({ error: 'TENANT_NOT_FOUND' }, 404);
    return context.json({ tenant: row });
  } catch {
    return context.json({ error: 'ADMIN_DATA_UNAVAILABLE' }, 503);
  }
});

adminRoutes.patch('/tenant', requireTenantPermission('tenant.manage'), async (context) => {
  const input = tenantUpdateSchema.safeParse(await context.req.json().catch(() => null));
  if (!input.success) return context.json({ error: 'INVALID_TENANT_UPDATE' }, 400);
  const tenant = context.get('tenantContext');
  try {
    const result = await context.env.DB.prepare(`
      UPDATE tenants SET name = ?, updated_at = datetime('now') WHERE id = ? AND status = 'active'
    `).bind(input.data.name, tenant.tenantId).run();
    if (result.meta.changes !== 1) return context.json({ error: 'TENANT_NOT_FOUND' }, 404);
    return context.json({ updated: true, name: input.data.name });
  } catch {
    return context.json({ error: 'TENANT_UPDATE_UNAVAILABLE' }, 503);
  }
});

adminRoutes.get('/users', async (context) => {
  const parsed = listQuery.safeParse(context.req.query());
  if (!parsed.success) return context.json({ error: 'INVALID_QUERY' }, 400);

  const tenant = context.get('tenantContext');
  const { q, limit, offset } = parsed.data;
  const search = q ? `%${q.replace(/[!%_]/g, '!$&')}%` : null;
  try {
    const result = await context.env.DB.prepare(`
      SELECT u.id, u.name, u.email, u.emailVerified, m.role, m.status AS membership_status,
        m.created_at AS joined_at
      FROM tenant_memberships m
      JOIN user u ON u.id = m.user_id
      WHERE m.tenant_id = ?
        AND (? IS NULL OR u.name LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!')
      ORDER BY m.created_at DESC, u.id ASC
      LIMIT ? OFFSET ?
    `).bind(tenant.tenantId, search, search, search, limit, offset).all();

    const count = await context.env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM tenant_memberships m
      JOIN user u ON u.id = m.user_id
      WHERE m.tenant_id = ?
        AND (? IS NULL OR u.name LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!')
    `).bind(tenant.tenantId, search, search, search).first<{ total: number }>();

    return context.json({
      users: result.results,
      actorUserId: context.get('authSession').user.id,
      pagination: { limit, offset, total: count?.total ?? 0 },
    });
  } catch {
    return context.json({ error: 'ADMIN_DATA_UNAVAILABLE' }, 503);
  }
});

adminRoutes.patch('/users/:userId', async (context) => {
  const userId = context.req.param('userId');
  const input = membershipUpdateSchema.safeParse(await context.req.json().catch(() => null));
  if (!input.success || !userId || userId.length > 128) return context.json({ error: 'INVALID_MEMBERSHIP_UPDATE' }, 400);

  const tenant = context.get('tenantContext');
  const actor = context.get('authSession').user.id;
  if (userId === actor) return context.json({ error: 'CANNOT_CHANGE_OWN_MEMBERSHIP' }, 409);
  try {
    const membership = await context.env.DB.prepare(`
      SELECT role, status FROM tenant_memberships WHERE tenant_id = ? AND user_id = ?
    `).bind(tenant.tenantId, userId).first<{ role: string; status: string }>();
    if (!membership) return context.json({ error: 'TENANT_MEMBER_NOT_FOUND' }, 404);
    if (membership.role === 'owner') return context.json({ error: 'OWNER_TRANSFER_REQUIRED' }, 409);

    const role = input.data.role ?? membership.role;
    const status = input.data.status ?? membership.status;
    if (role === membership.role && status === membership.status) {
      return context.json({ updated: true, role, status });
    }

    const update = await context.env.DB.prepare(`
      UPDATE tenant_memberships
      SET role = ?, status = ?, permission_version = permission_version + 1
      WHERE tenant_id = ? AND user_id = ? AND role = ? AND status = ? AND role != 'owner'
    `).bind(role, status, tenant.tenantId, userId, membership.role, membership.status).run();
    if (update.meta.changes !== 1) return context.json({ error: 'MEMBERSHIP_CHANGED_RETRY' }, 409);
    return context.json({ updated: true, role, status });
  } catch {
    return context.json({ error: 'MEMBERSHIP_UPDATE_UNAVAILABLE' }, 503);
  }
});

adminRoutes.get('/billing', async (context) => {
  const tenant = context.get('tenantContext');
  try {
    const result = await context.env.DB.prepare(`
      SELECT e.provider, e.provider_reference, e.plan_key, p.display_name AS plan_name,
        e.status, e.current_period_end, e.updated_at
      FROM billing_entitlements e
      LEFT JOIN billing_plans p ON p.plan_key = e.plan_key
      WHERE e.tenant_id = ?
      ORDER BY e.updated_at DESC
      LIMIT 100
    `).bind(tenant.tenantId).all();
    return context.json({ entitlements: result.results });
  } catch (error) {
    // The billing migration may not be enabled in projects that omit the billing module.
    if (error instanceof Error && /no such table/i.test(error.message)) {
      return context.json({ error: 'BILLING_MODULE_NOT_CONFIGURED' }, 501);
    }
    return context.json({ error: 'ADMIN_DATA_UNAVAILABLE' }, 503);
  }
});
