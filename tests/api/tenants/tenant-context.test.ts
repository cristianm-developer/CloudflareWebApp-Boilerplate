import { describe, expect, it } from 'vitest';
import { verifyTenantContextToken, type TenantBindings } from '../../../api/modules/tenants';

const secret = new TextEncoder().encode('unit-test-tenant-context-secret-at-least-32-bytes');
const env = { TENANT_CONTEXT_SECRET: new TextDecoder().decode(secret) } as TenantBindings;

async function signedToken(overrides: Record<string, unknown> = {}, options: { audience?: string; algorithm?: string; expires?: number } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: options.algorithm ?? 'HS256', typ: 'JWT' };
  const payload = {
    tenantId: 'tenant-1',
    membershipId: 'membership-1',
    role: 'owner',
    permissions: ['tenant.read'],
    permissionVersion: 1,
    ...overrides,
    iss: 'urn:cloudflare-apps:tenant-context',
    aud: options.audience ?? 'cloudflare-apps-api',
    sub: 'user-1',
    iat: now,
    jti: 'token-1',
    exp: options.expires ?? now + 60,
  };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${Buffer.from(signature).toString('base64url')}`;
}

describe('tenant context token verification', () => {
  it('accepts a correctly signed, audience-bound token with known permissions', async () => {
    const claims = await verifyTenantContextToken(await signedToken(), env);
    expect(claims).toMatchObject({ sub: 'user-1', tenantId: 'tenant-1', membershipId: 'membership-1', role: 'owner' });
  });

  it('rejects a token signed for a different audience', async () => {
    expect(await verifyTenantContextToken(await signedToken({}, { audience: 'another-api' }), env)).toBeNull();
  });

  it('rejects unknown permission claims even when the signature is valid', async () => {
    expect(await verifyTenantContextToken(await signedToken({ permissions: ['tenant.read', 'tenant.superuser'] }), env)).toBeNull();
  });

  it('rejects a different signing algorithm', async () => {
    const token = await signedToken({}, { algorithm: 'HS512' });
    expect(await verifyTenantContextToken(token, env)).toBeNull();
  });

  it('fails closed when the environment secret is missing or too short', async () => {
    const token = await signedToken();
    expect(await verifyTenantContextToken(token, { TENANT_CONTEXT_SECRET: 'short' } as TenantBindings)).toBeNull();
    expect(await verifyTenantContextToken(token, {} as TenantBindings)).toBeNull();
  });
});
