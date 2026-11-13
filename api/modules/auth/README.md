# Better Auth module

`createAuth(env)` creates an instance per request and uses the request's D1 binding through Drizzle. Google OAuth is enabled only when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. The primary session is Better Auth's persisted, cookie-backed session; cookie caching is disabled so revocation is checked against D1.

## Apply the schema before signup

Better Auth does not create schema from request handlers. The D1 SQL matching `schema.ts` is in `schema.sql`. Copy it into a new, numbered migration under `/migrations` (for example, `0002_better_auth.sql`) and apply with the existing Wrangler migration commands for local, Preview, and production databases. Do this before enabling the auth endpoints. Keep the migration in source control and apply the same migration to each isolated database.

The schema intentionally omits Better Auth's Admin plugin fields. Add those only with a separate explicit migration if the app later enables that plugin.

## Hono wiring

Mount the Better Auth handler before generic API not-found handling:

```ts
import { createAuthHandler } from './modules/auth';

api.on(['GET', 'POST'], '/auth/*', (context) =>
  createAuthHandler(context.env)(context.req.raw),
);
```

Required server secrets are `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`. Configure `TENANT_CONTEXT_SECRET` separately for tenant-context JWTs. Google OAuth credentials are optional but must be configured as a pair.
