# Tenant context

The user authenticates with Better Auth's persisted session cookie. The web client then requests a short-lived tenant token from `POST /api/tenants/:tenantId/context-token` and sends it on subsequent requests as `X-Tenant-Context`. Use `personal` as the route key to resolve or ensure the user's personal workspace.

`GET /api/tenants` returns only the signed-in user's active memberships. `POST /api/tenants` creates an organization tenant with the current user as owner. The UI may persist the selected tenant ID as a convenience, but it is never accepted as authorization; each context-token grant confirms the current membership in D1.

The middleware requires both credentials, confirms the token subject matches the Better Auth session, and re-reads the active membership and `permission_version` from D1 on every request. A membership removal, suspension, role change, version bump, tenant suspension, or session revocation therefore takes effect without waiting for the JWT to expire. The JWT is context-bound and does not replace the session cookie.

## Hono wiring

Mount the token route without tenant-context middleware, because it is the endpoint that issues the context token:

```ts
import { tenantContextRoutes, tenantContextMiddleware, requireTenantPermission } from './modules/tenants';

api.route('/tenants', tenantContextRoutes);

const tenantApi = new Hono<TenantHonoEnv>();
tenantApi.use('*', tenantContextMiddleware());
tenantApi.get('/settings', requireTenantPermission('tenant.read'), (context) => {
  const tenant = context.get('tenantContext');
  return context.json({ tenantId: tenant.tenantId });
});
api.route('/tenant-data', tenantApi);
```

Import `TenantHonoEnv` in route modules that use the middleware. Do not mount `tenantContextMiddleware` over the context-token route.

## Permissions

The initial role-to-capability map lives in `api/modules/tenants/index.ts` and fails closed for unknown roles. Every permission or membership mutation must increment `tenant_memberships.permission_version`; the token middleware checks that value on every request. Keep the permission map aligned with the shared `permissionNames` contract.

`TENANT_CONTEXT_SECRET` must be a separate random value of at least 32 bytes in each environment. Never reuse the Better Auth secret or send this secret to clients.
