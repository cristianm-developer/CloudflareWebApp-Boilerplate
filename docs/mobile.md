# Flutter mobile app and Google Play Billing

This document describes the optional Android app that wraps the web product and adds native capabilities. The mobile app is not a second implementation of the product: Astro/Preact remains the main UI, while Flutter owns the WebView container, store billing, and device integrations.

## Shape of the integration

```text
Flutter Android app
├── WebView: Astro/Preact at the configured environment URL
├── native bridge: billing, share, external links, file picker, app metadata
└── Google Play Billing client
         │ purchaseToken + product ID
         ▼
Astro/Preact ── authenticated POST ──> Hono on Cloudflare Workers
                                      ├── Google Play Developer API verification
                                      ├── subscription and entitlement records in D1
                                      └── RTDN push endpoint <── Google Cloud Pub/Sub
```

Keep the same user and tenant model across browser and mobile. Storefront is a billing source (`stripe` or `google_play`), not a separate authorization model. Product access should derive from a backend entitlement record linked to the user and, where appropriate, their active tenant.

## Flutter app responsibilities

- Host the app origin in a `webview_flutter` WebView.
- Define build flavors/configuration for `local`, `stage`, and `production` URLs and Android application IDs as needed.
- Listen to `InAppPurchase.instance.purchaseStream` from app startup so pending and restored transactions are handled after relaunch.
- Query products from Google Play and launch billing UI only after a user action.
- Send purchase results to the web app through a narrow bridge; do not make the Flutter UI the source of truth for account access.
- Handle Android back navigation, external links, file selection, sharing, and app lifecycle without granting the page unrestricted native access.

Use the maintained Flutter packages [`webview_flutter`](https://pub.dev/packages/webview_flutter) and [`in_app_purchase`](https://pub.dev/packages/in_app_purchase). Pin versions through normal dependency management and revisit them during planned upgrades.

## WebView and JavaScript bridge

Keep the bridge an explicit, versioned protocol. Suggested messages:

```json
{"version":1,"id":"request-id","type":"billing.purchase","productId":"pro_monthly"}
{"version":1,"id":"request-id","type":"billing.restore"}
{"version":1,"id":"request-id","type":"device.share","title":"...","url":"..."}
```

Responses should include the same `id`, a result type, and only the fields needed by the web app. For a successful purchase, the response can include the Play `purchaseToken`, product ID, and purchase state so the web page can submit it to Hono using its existing authenticated API client.

Security requirements:

- Allow only the configured app origin in the WebView and bridge. Reject other hosts, schemes, and unexpected navigation; open approved external links in the system browser.
- Expose a small allowlist of native operations. Never expose arbitrary method invocation, filesystem access, or a generic JavaScript evaluation endpoint.
- Treat every bridge message and every value returned by it as untrusted input. Validate message version, size, request ID, enum values, and product IDs on both sides.
- Keep Better Auth's session in the WebView's same-origin secure cookies. Do not pass Better Auth session secrets or long-lived bearer tokens through the bridge.
- Do not embed Google service-account credentials, Stripe secrets, or API provider keys in the APK.
- Disable WebView debugging in release builds. Do not bypass TLS errors in release builds.

The mobile app loads a trusted, first-party origin. A development/stage flavor may use a different allowlisted origin; it must not silently fall back to production.

## Google Play purchase flow

1. The web UI requests a purchase through the bridge. Flutter queries current Play product details and launches the Google Play purchase flow.
2. Flutter listens for the purchase update. `pending` is shown as pending and grants no access. Only `purchased` is sent for server validation. `restored` purchases also go through server validation.
3. The page submits product ID and purchase token to `POST /api/billing/google-play/verify`. The package name comes from backend environment configuration. Hono derives the user from Better Auth and the tenant from the verified tenant-context JWT; it never trusts a user or tenant ID supplied as a purchase owner.
4. The backend validates the app package and product against server configuration, looks up the purchase using the Google Play Developer API (`purchases.subscriptionsv2.get` for subscriptions), checks state and ownership/mapping, and rejects duplicate or already-claimed purchase tokens. Persist the token uniquely for idempotency.
5. In one idempotent backend operation, persist the verified transaction and update the entitlement. Return the resulting entitlement to the page so it can refresh TanStack Query state.
6. Complete/acknowledge the transaction only after successful verification and entitlement processing. Prefer server-side acknowledgement through the Play Developer API where configured; otherwise complete the Flutter transaction after the backend confirms processing. Never acknowledge a pending purchase.

The client can be interrupted at any point, so the endpoint must safely handle retries. On app resume, process the purchase stream and query/restored purchases again. If verification is temporarily unavailable, keep the purchase unfulfilled and retry; do not grant access based only on a client callback.

The Flutter plugin documents the purchase stream, restore flow, and `completePurchase`; Android purchases that remain uncompleted may be refunded after the acknowledgement window. See [Flutter in-app purchases](https://pub.dev/packages/in_app_purchase), [Google Play purchase integration](https://developer.android.com/google/play/billing/integrate), and [purchase verification security guidance](https://developer.android.com/google/play/billing/security).

## Backend records and entitlements

Recommended minimum records (field names illustrative):

- `billing_customers`: tenant/user and provider customer mapping.
- `store_purchases`: provider, globally unique purchase token, product ID, package name, state, linked user/tenant, verified timestamps, raw provider status needed for support.
- `subscriptions`: provider subscription ID/token reference, normalized status, period end, cancellation state, last provider event time.
- `entitlements`: subject, entitlement key, source purchase, effective start/end, and state.
- `billing_events`: provider event ID and processing state for webhook/RTDN deduplication and audit.

Use unique constraints for purchase tokens and provider event IDs. Keep the raw token private, limit log exposure, and never log service-account credentials. Normalize statuses such as `active`, `grace_period`, `on_hold`, `canceled`, `expired`, `pending`, and `revoked` into the same authorization contract used by Stripe.

## RTDN subscription lifecycle

Configure Google Play Real-time Developer Notifications (RTDN) to publish to a Google Cloud Pub/Sub topic. Configure an authenticated push subscription to a dedicated Hono endpoint (or a separately secured receiver that hands validated events to Hono). Authenticate the Pub/Sub push request; do not accept unauthenticated lifecycle events merely because they contain a purchase token.

Treat RTDN as a signal to refresh state, not as the authoritative subscription record. After validating the push envelope, fetch the current purchase/subscription state from Google Play, then update the local subscription and entitlement idempotently. Handle renewals, cancellations, expirations, grace period, account hold, recovery, revocations, and voided purchases as applicable. Google documents RTDN as the timely lifecycle signal and Play Developer API as the way to retrieve current purchase state: [purchase lifecycle and RTDN](https://developer.android.com/google/play/billing/lifecycle) and [server backend integration](https://developer.android.com/google/play/billing/backend).

Cloudflare Workers must receive only the minimum needed service credentials as environment secrets. Keep Google Cloud/Pub/Sub setup outside the mobile binary and outside checked-in configuration.

## Session and tenant behavior

Better Auth authenticates the web app in the WebView through its regular same-origin session. When the user selects a tenant, the web app obtains the signed tenant-context JWT using the authenticated session and sends it on API requests. Hono verifies its signature, issuer, audience, expiration, and permission version, then confirms current membership/permissions as required before billing or account operations. The purchase endpoint associates a purchase with the authenticated account and active authorized tenant; the purchase token is not proof of identity.

If the user changes tenants during a purchase, bind the purchase to the intended account/tenant server-side and reject mismatches. For subscriptions that are user-level rather than tenant-level, declare that policy explicitly in the entitlement model instead of inferring it from whichever tenant happens to be selected.

## Local and stage setup

- Run the web/API locally with Wrangler local mode and local D1/R2 data. Configure the Flutter `local` flavor to the host-reachable development URL; Android emulators generally need a host alias rather than `localhost`.
- Use a dedicated stage Preview URL and stage D1/R2 bindings for the `stage` flavor. Keep stage Play products, package configuration, and credentials isolated from production wherever Play Console permits. Restrict stage access to testers.
- Production flavor targets the production app origin and production Play product IDs only.
- Never use production purchase credentials or live billing products for local manual testing. Use Play license testers and Play test tracks.
- Play purchases can require installation through a Play test track; a locally sideloaded debug build may not reproduce the full store behavior.

## Manual Play Console and Google Cloud setup

The CLI can scaffold code, IDs, manifests, secret names, and setup instructions, but the account owner must complete these external steps:

1. Create/register the Android application in Play Console and select a unique package ID and signing setup.
2. Create subscription products/base plans (and one-time products if needed); record product IDs in environment configuration.
3. Configure license testers and an internal/closed test track for validation.
4. Link the Play app to a Google Cloud project, enable the Google Play Developer API, grant the required service-account access in Play Console, and store credentials as Cloudflare secrets.
5. Configure RTDN topic and authenticated Pub/Sub push subscription targeting `/api/billing/google-play/rtdn`; set the expected audience and service-account email in the same environment.
6. Configure application signing, privacy/data safety disclosures, subscription terms, and store listing before release.

## Release checklist

- [ ] Confirm environment URL and Android application ID for the selected flavor.
- [ ] Verify WebView origin allowlist and external-navigation behavior.
- [ ] Verify purchase and restore flows while signed into the intended account and tenant.
- [ ] Confirm `PENDING` never grants entitlement and verification retries are safe.
- [ ] Confirm unique-token and RTDN deduplication behavior.
- [ ] Confirm acknowledgement happens only after successful verification/fulfillment.
- [ ] Exercise renewal, cancel, expire, refund/revoke, and recovery via Play test tools.
- [ ] Confirm stage and production use distinct D1/R2 bindings and credentials.
- [ ] Build/sign the release artifact using the documented Flutter release process.
