# Boilerplate architecture

## Modular application in one Worker

Astro serves the landing page, application pages, and server-side rendered routes. Preact powers interactive islands. An Astro catch-all endpoint forwards `/api/*` requests to Hono in the same Worker and explicitly passes the Cloudflare environment. Business modules are grouped by capability; external services are not created by default.

```text
apps/web/src/
  pages/                  # Landing page, SSR, and Astro routes
  components/             # Reusable Preact islands
  lib/                    # Auth client, HTTP client, and stores
  styles/                 # Global Tailwind tokens
api/
  router.ts               # Hono routes under /api
  middleware/             # Rate limiting
  modules/
    auth/ tenants/ quotas/ # Sessions, tenant context, and usage
    billing/ ai/ email/   # Stripe, Google Play, OpenRouter, and Resend
    admin/                # Tenant-scoped administration
packages/
  contracts/              # Shared Zod contracts
  cli/                    # Project generation and configuration CLI
apps/mobile/              # Optional Flutter shell
```

The `api/modules/quotas` module tracks product usage per tenant and capability, with UTC daily, weekly, or monthly windows and atomic D1 counters. Usage rows are retained until 90 days after their window ends. A daily Cron Trigger removes expired rows in bounded batches from the D1 database bound to that deployment. Billing synchronizes plan quota policies while preserving manual and add-on policies. Cloudflare rate limiting protects request volume; quotas meter product usage.

Each module separates routes/handlers, schemas, services, repositories, and policies. Routes translate HTTP requests into application calls; services apply rules and orchestrate work; repositories encapsulate D1. The UI does not contain authorization rules. The CLI records optional modules as planned when their implementation is not present in the project scaffold.

## Active tenant context

Better Auth maintains the primary session. After a user selects a tenant, the client requests a short-lived secondary JWT from the backend and sends it with authenticated API requests. The backend validates the signature, issuer, audience, expiration, and subject, binds the subject to the session, and rechecks membership and permission version in D1. A client-supplied `tenantId` is never accepted as authorization. A personal tenant is created idempotently during onboarding.

Use `jose` with Web Crypto for JWT operations. Keep current membership and permissions in D1 so access can be revoked without waiting for a token to expire. The tenant token is bound to context and does not replace the session.

## Permissions

Permissions are stable capabilities such as `members.invite`, `billing.manage`, and `records.read`; roles group capabilities. Policies live in the backend and are enforced by handlers/services. Components may hide unavailable actions, but that never grants access.

## Cloudflare environments

The application uses one Worker: the top-level configuration is production, and the `previews` block configures Worker Previews. Each environment keeps the same binding names but points to independent D1 and R2 resources. The `main` branch supplies the base configuration inherited by branch Previews. Apply migrations explicitly to every database.

Wrangler local mode uses local storage. Never use production secrets in `.dev.vars`; Git ignores this file. Use Wrangler secrets for production and the appropriate Preview configuration for Preview secrets.

## Billing and entitlements

Stripe Checkout/webhooks and Google Play verification/RTDN publish provider-neutral entitlements linked to a tenant. The backend validates Stripe signatures and verifies Play tokens through the Android Publisher API before granting access. The mobile bridge completes a purchase only after the server confirms verification and processing. Each provider is behind an adapter, and plan resolution applies its D1 quota policy.

## Optional modules

OpenRouter, Resend, Stripe, Google Play, and Flutter can be selected/configured with the CLI. Each provider is behind an adapter; builds do not require provider credentials. Admin operations are scoped to the active tenant and require `admin.manage`; there is no cross-tenant superadmin role.
