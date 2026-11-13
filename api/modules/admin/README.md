# Tenant admin API

These routes are intended to be mounted at `/api/admin`. Every endpoint first requires the already-authenticated active tenant context, then checks `admin.manage`. Requests cannot select a tenant; tenant and user queries use only the authorized context's `tenantId`.

- `GET /tenant`: current tenant and membership counts.
- `PATCH /tenant`: rename the active tenant (`tenant.manage`).
- `GET /users?q=&limit=&offset=`: paginated users who belong to this tenant.
- `PATCH /users/:userId`: change a non-owner member's role (`admin`, `member`, `viewer`) or suspend/reactivate membership; permission version increments on every change.
- `GET /billing`: provider-neutral entitlements for this tenant, when the billing migration is installed.
- `GET /health`: configuration-only status for Worker bindings and optional providers. It returns status/summary text only; it never returns secret values or calls providers, D1, or R2. “Configured” means present and basic format checks passed, not that a provider is reachable or migrations are applied.

The API is tenant-local. It does not implement cross-tenant platform operators, a system-admin role, invitations, or ownership transfer. Owners cannot be modified through member management. Billing queries return no provider secrets or purchase tokens.
