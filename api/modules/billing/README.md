# Billing module foundation

This module keeps Stripe web subscriptions and Google Play subscriptions behind provider-neutral `billing_entitlements`. Its scope is intentionally server-side: no route accepts a client-settable plan, entitlement status, tenant ID, or quota limit.

## Data model and plan mapping

Apply `migrations/0004_billing.sql` after the tenant, auth, and quota migrations. Provision `billing_plans`, `billing_plan_quotas`, and `billing_products` with trusted setup/admin tooling. `billing_products.product_id` means a Stripe Price ID for `stripe`, and a Play subscription product ID for `google-play`. The authenticated `/stripe/checkout` route accepts only a mapped product ID; it derives tenant and user from the verified request context and creates/links the Stripe customer on the server.

`resolveTenantPlan(db, activeTenantContext)` returns the highest-ranked active/trialing plan, its provider-neutral entitlements, and quota policy. `syncTenantQuotaPolicies(db, activeTenantContext)` applies that plan to D1 quota policies with source `plan`; manually provisioned/add-on policies are kept. Stripe and Play handlers use the same internal reconciliation after verified provider state changes.

## Stripe

Mount `billingRoutes` at `/api/billing`. Configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `APP_BASE_URL` with Wrangler for each environment. `GET /api/billing/plans` returns active products. `POST /api/billing/stripe/checkout` accepts `{ productId }` and returns a Stripe Checkout URL; it does not accept tenant IDs, prices, or redirect URLs from the client. Stripe sends `POST /api/billing/stripe/webhook`; the handler verifies the raw body with its signature and five-minute timestamp tolerance, maps subscription events through the stored customer and Price mappings, applies only non-stale event versions, and records event IDs for idempotent retries. Unknown customer/Price mappings return 503 so the webhook can retry after configuration is corrected.

The handler follows Stripe's signed-webhook pattern and subscription lifecycle events: [webhook signature verification](https://docs.stripe.com/webhooks/signature), [subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks). Subscription item periods are read from item-level `current_period_end` to accommodate current Stripe API versions. It bounds request body reads before parsing, requires HTTPS for checkout/portal redirects outside local development, and records an event ID only after quota reconciliation succeeds so provider retries can repair transient D1 failures.

## Google Play

Configure `GOOGLE_PLAY_PACKAGE_NAME` and the secret `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` for each environment. The authenticated `POST /api/billing/google-play/verify` requires the Better Auth session and active-tenant JWT; body is `{ "productId": "...", "purchaseToken": "..." }`. It verifies the token using Google OAuth service-account credentials and `purchases.subscriptionsv2.get`, checks the requested product and expiry, hashes the purchase token before persistence, prevents a token from being linked to another user/tenant, then syncs the entitlement and quota policy. Missing credentials/provider availability returns 503; invalid or inactive purchases fail closed with 422. Only verified active, in-grace, or canceled-but-unexpired subscriptions return `{ verified: true, entitlement }`.

The public `POST /api/billing/google-play/rtdn` push endpoint requires an authenticated Pub/Sub OIDC token. Configure `GOOGLE_PUBSUB_AUDIENCE` to the exact push URL and `GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL` to the expected identity. After envelope, signature, issuer, audience, verified-email, and package checks, it uses the notification only to locate a previously linked token and re-queries the Developer API for current state. Notification claims never grant access. Unknown tokens are acknowledged without granting; the authenticated purchase-verification endpoint establishes the initial token-to-tenant association.

See Google's [subscription verification API](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get), [server backend guidance](https://developer.android.com/google/play/billing/backend), [RTDN reference](https://developer.android.com/google/play/billing/rtdn-reference), and [authenticated Pub/Sub push guidance](https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions).

## Project-specific setup still required

- Add actual plan, product/Price, and plan quota rows through trusted seed/admin logic.
- Configure separate production and Preview provider secrets; never reuse credentials across environments.
- Create a tenant-scoped Checkout Session route and persist `billing_customers` before redirecting to Stripe.
- Configure Google Play Console products, service account access, Pub/Sub topic/subscription, and exact audience/email.
- For Play test purchases, verify device behavior and acknowledge/complete only after the server returns success.
- Add refund/voided-purchase, one-time product, grace-period policy, cancellation UX, portal, and reconciliation jobs as required by the final product.
