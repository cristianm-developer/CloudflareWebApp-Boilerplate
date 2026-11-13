import { Hono, type MiddlewareHandler } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { permissionNames, type PermissionName } from '@boilerplate/contracts';
import type { WorkerEnv } from '../../env';
import { getAuthSession, type AuthBindings, type AuthSession } from '../auth';
import { ensurePersonalTenant } from './storage';

const TENANT_ISSUER = 'urn:cloudflare-apps:tenant-context';
const TENANT_AUDIENCE = 'cloudflare-apps-api';
const TENANT_CONTEXT_TTL_SECONDS = 10 * 60;
const MAX_TOKEN_TTL_SECONDS = 15 * 60;

export interface TenantBindings extends AuthBindings {
  TENANT_CONTEXT_SECRET?: string;
}

export interface TenantContextClaims {
  sub: string;
  tenantId: string;
  membershipId: string;
  role: string;
  permissions: PermissionName[];
  permissionVersion: number;
  iat: number;
  exp: number;
  jti: string;
}

export interface ActiveTenantContext extends TenantContextClaims {
  key: string;
}

export interface TenantContextVariables {
  authSession: AuthSession;
  tenantContext: ActiveTenantContext;
}

export type TenantHonoEnv = {
  Bindings: TenantBindings;
  Variables: TenantContextVariables;
};

interface MembershipRow {
  tenant_id: string;
  tenant_slug: string;
  tenant_status: string;
  membership_id: string;
  membership_status: string;
  role: string;
  permission_version: number;
}

const permissionsByRole: Record<string, PermissionName[]> = {
  owner: [...permissionNames],
  admin: [...permissionNames],
  member: ['tenant.read', 'members.read', 'billing.read'],
  viewer: ['tenant.read'],
};

function tenantSecret(env: TenantBindings): Uint8Array {
  const secret = env.TENANT_CONTEXT_SECRET;
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error('TENANT_CONTEXT_SECRET must be set and at least 32 bytes.');
  }
  return new TextEncoder().encode(secret);
}

function permissionsForRole(role: string): PermissionName[] {
  return permissionsByRole[role] ? [...permissionsByRole[role]] : [];
}

async function membershipForUser(db: D1Database, userId: string, tenantId: string): Promise<MembershipRow | null> {
  return db.prepare(
    `SELECT t.id AS tenant_id, t.slug AS tenant_slug, t.status AS tenant_status,
            m.id AS membership_id, m.status AS membership_status, m.role,
            m.permission_version
     FROM tenants AS t
     JOIN tenant_memberships AS m ON m.tenant_id = t.id
     WHERE t.id = ? AND m.user_id = ?
     LIMIT 1`,
  ).bind(tenantId, userId).first<MembershipRow>();
}

export { ensurePersonalTenant };

export async function issueTenantContextToken(
  env: TenantBindings,
  user: { id: string; name?: string | null },
  tenantRef: string,
): Promise<{ accessToken: string; tokenType: 'Tenant'; expiresIn: number; tenant: { id: string; key: string; role: string; permissions: PermissionName[] } } | null> {
  const secret = tenantSecret(env);
  const tenantId = tenantRef === 'personal' ? await ensurePersonalTenant(env.DB, user) : tenantRef;
  const membership = await membershipForUser(env.DB, user.id, tenantId);
  if (!membership || membership.tenant_status !== 'active' || membership.membership_status !== 'active') return null;

  const permissions = permissionsForRole(membership.role);
  const now = Math.floor(Date.now() / 1000);
  const accessToken = await new SignJWT({
    tenantId: membership.tenant_id,
    membershipId: membership.membership_id,
    role: membership.role,
    permissions,
    permissionVersion: membership.permission_version,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(TENANT_ISSUER)
    .setAudience(TENANT_AUDIENCE)
    .setSubject(user.id)
    .setIssuedAt(now)
    .setJti(crypto.randomUUID())
    .setExpirationTime(now + TENANT_CONTEXT_TTL_SECONDS)
    .sign(secret);

  return {
    accessToken,
    tokenType: 'Tenant',
    expiresIn: TENANT_CONTEXT_TTL_SECONDS,
    tenant: {
      id: membership.tenant_id,
      key: membership.tenant_slug,
      role: membership.role,
      permissions,
    },
  };
}

function isPermissionName(value: unknown): value is PermissionName {
  return typeof value === 'string' && (permissionNames as readonly string[]).includes(value);
}

export async function verifyTenantContextToken(
  token: string,
  env: TenantBindings,
): Promise<TenantContextClaims | null> {
  try {
    const { payload } = await jwtVerify(token, tenantSecret(env), {
      algorithms: ['HS256'],
      issuer: TENANT_ISSUER,
      audience: TENANT_AUDIENCE,
      requiredClaims: ['sub', 'iat', 'exp', 'jti'],
      maxTokenAge: `${MAX_TOKEN_TTL_SECONDS}s`,
    });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.tenantId !== 'string' ||
      typeof payload.membershipId !== 'string' ||
      typeof payload.role !== 'string' ||
      typeof payload.permissionVersion !== 'number' ||
      !Number.isInteger(payload.permissionVersion) ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number' ||
      typeof payload.jti !== 'string' ||
      !Array.isArray(payload.permissions) ||
      !payload.permissions.every(isPermissionName)
    ) return null;
    return payload as unknown as TenantContextClaims;
  } catch {
    return null;
  }
}

export function tenantContextMiddleware(): MiddlewareHandler<TenantHonoEnv> {
  return async (context, next) => {
    const session = await getAuthSession(context.env, context.req.raw.headers);
    if (!session) return context.json({ error: 'AUTH_REQUIRED' }, 401);

    const token = context.req.header('X-Tenant-Context');
    if (!token) return context.json({ error: 'TENANT_CONTEXT_REQUIRED' }, 401);
    const claims = await verifyTenantContextToken(token, context.env);
    if (!claims) return context.json({ error: 'TENANT_CONTEXT_INVALID' }, 401);
    if (claims.sub !== session.user.id) return context.json({ error: 'TENANT_CONTEXT_MISMATCH' }, 403);

    const requestedTenant = context.req.param('tenantId');
    if (requestedTenant && requestedTenant !== claims.tenantId) {
      return context.json({ error: 'TENANT_CONTEXT_MISMATCH' }, 403);
    }

    let membership: MembershipRow | null;
    try {
      membership = await membershipForUser(context.env.DB, session.user.id, claims.tenantId);
    } catch (error) {
      console.error('Tenant membership lookup failed', error);
      return context.json({ error: 'REQUEST_UNAVAILABLE' }, 503);
    }
    if (!membership || membership.tenant_status !== 'active' || membership.membership_status !== 'active') {
      return context.json({ error: 'TENANT_ACCESS_DENIED' }, 403);
    }
    if (membership.membership_id !== claims.membershipId || membership.permission_version !== claims.permissionVersion || membership.role !== claims.role) {
      return context.json({ error: 'TENANT_CONTEXT_STALE' }, 401);
    }

    const permissions = permissionsForRole(membership.role);
    context.set('authSession', session);
    context.set('tenantContext', { ...claims, key: membership.tenant_slug, permissions });
    await next();
  };
}

export function requireTenantPermission(permission: PermissionName): MiddlewareHandler<TenantHonoEnv> {
  return async (context, next) => {
    const tenant = context.get('tenantContext');
    if (!tenant?.permissions.includes(permission)) return context.json({ error: 'TENANT_PERMISSION_DENIED' }, 403);
    await next();
  };
}

export const tenantContextRoutes = new Hono<TenantHonoEnv>();

tenantContextRoutes.post('/', async (context) => {
  const session = await getAuthSession(context.env, context.req.raw.headers);
  if (!session) return context.json({ error: 'AUTH_REQUIRED' }, 401);
  const input = z.object({ name: z.string().trim().min(2).max(100) }).strict().safeParse(await context.req.json().catch(() => null));
  if (!input.success) return context.json({ error: 'INVALID_TENANT' }, 400);

  const tenantId = crypto.randomUUID();
  const slugBase = input.data.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'workspace';
  const slug = `${slugBase}-${crypto.randomUUID().slice(0, 8)}`;
  try {
    await context.env.DB.batch([
      context.env.DB.prepare(`
        INSERT INTO tenants (id, name, slug, kind, status) VALUES (?, ?, ?, 'organization', 'active')
      `).bind(tenantId, input.data.name, slug),
      context.env.DB.prepare(`
        INSERT INTO tenant_memberships (id, tenant_id, user_id, role, status, permission_version)
        VALUES (?, ?, ?, 'owner', 'active', 1)
      `).bind(crypto.randomUUID(), tenantId, session.user.id),
    ]);
    return context.json({ tenant: { id: tenantId, name: input.data.name, slug, kind: 'organization', role: 'owner' } }, 201);
  } catch {
    return context.json({ error: 'TENANT_CREATE_UNAVAILABLE' }, 503);
  }
});

tenantContextRoutes.get('/', async (context) => {
  const session = await getAuthSession(context.env, context.req.raw.headers);
  if (!session) return context.json({ error: 'AUTH_REQUIRED' }, 401);
  try {
    const result = await context.env.DB.prepare(`
      SELECT t.id, t.name, t.slug, t.kind, m.role
      FROM tenants t
      JOIN tenant_memberships m ON m.tenant_id = t.id
      WHERE m.user_id = ? AND m.status = 'active' AND t.status = 'active'
      ORDER BY CASE WHEN t.kind = 'personal' THEN 0 ELSE 1 END, t.name COLLATE NOCASE
    `).bind(session.user.id).all<{ id: string; name: string; slug: string; kind: string; role: string }>();
    return context.json({ tenants: result.results ?? [] });
  } catch {
    return context.json({ error: 'TENANT_LIST_UNAVAILABLE' }, 503);
  }
});

tenantContextRoutes.post('/:tenantId/context-token', async (context) => {
  const session = await getAuthSession(context.env, context.req.raw.headers);
  if (!session) return context.json({ error: 'AUTH_REQUIRED' }, 401);
  try {
    const issued = await issueTenantContextToken(context.env, session.user, context.req.param('tenantId'));
    if (!issued) return context.json({ error: 'TENANT_ACCESS_DENIED' }, 403);
    return context.json(issued);
  } catch (error) {
    console.error('Tenant context token issuance failed', error);
    return context.json({ error: 'REQUEST_UNAVAILABLE' }, 503);
  }
});

export async function requireSignedInUser(env: TenantBindings, headers: Headers): Promise<AuthSession | null> {
  return getAuthSession(env, headers);
}
