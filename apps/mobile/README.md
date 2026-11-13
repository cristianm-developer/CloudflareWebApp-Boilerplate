# Flutter app shell

This Android Flutter app displays the Astro/Preact product in a WebView and exposes a small native bridge for Google Play purchases. Flutter does not verify purchases or grant entitlements. The web app sends the emitted purchase token to `POST /api/billing/google-play/verify`; after the Hono endpoint confirms processing, the web app calls `billing.complete` to finish the store transaction.

## Environments

The Android product flavors are `local`, `stage`, and `production`. Dart compile-time values select the app origin and the allowed Play product IDs. Replace the sample stage and production domains with the project's real HTTPS origins.

Local Android emulator (Astro dev server on host port 4321):

```powershell
flutter run --flavor local `
  --dart-define=APP_ENV=local `
  --dart-define=LOCAL_APP_ORIGIN=http://10.0.2.2:4321
```

Stage:

```powershell
flutter run --flavor stage `
  --dart-define=APP_ENV=stage `
  --dart-define=STAGE_APP_ORIGIN=https://stage.example.com `
  --dart-define=PLAY_PRODUCT_IDS=pro_monthly,pro_annual
```

Production build:

```powershell
flutter build appbundle --flavor production `
  --dart-define=APP_ENV=production `
  --dart-define=PRODUCTION_APP_ORIGIN=https://app.example.com `
  --dart-define=PLAY_PRODUCT_IDS=pro_monthly,pro_annual
```

For a physical device, set `LOCAL_APP_ORIGIN` to an address reachable from that device. Only the local flavor permits HTTP. Stage and production require HTTPS. Each build uses one exact configured origin for both initial load and same-origin navigation; external links are blocked by this skeleton.

## Bridge protocol

The page posts JSON to `NativeBridge.postMessage`:

```javascript
NativeBridge.postMessage(JSON.stringify({
  version: 1,
  nonce: window.__NATIVE_BRIDGE_NONCE,
  id: crypto.randomUUID(),
  type: 'billing.purchase',
  productId: 'pro_monthly',
}));
```

Supported request types:

- `billing.purchase` with an allowlisted `productId`.
- `billing.restore` to ask the Play store to restore purchases.
- `billing.complete` with the `purchaseId` emitted for a purchase that the backend has verified and processed.

Native responses and purchase updates arrive as `nativeBridgeEvent` custom events. The `purchaseToken` is included only on `purchased` or `restored` updates. The web app must submit it to the backend and wait for a successful verification/entitlement response before calling `billing.complete`.

The nonce blocks messages that were not sent by the currently loaded main page, and the current URL is checked against the configured origin. Keep the WebView content first-party and do not embed untrusted cross-origin frames: platform JavaScript channels do not expose the source frame origin to Dart.

## Google Play setup still required

- Register the app and configure package IDs, signing, products, base plans, and test tracks in Play Console.
- Add license testers and validate through a Play test track.
- Set product IDs via `PLAY_PRODUCT_IDS` for the matching environment.
- Configure the authenticated Hono purchase endpoint, Google Play Developer API credentials, plan/product mappings, and authenticated RTDN push before enabling production purchases.
- Never put Google service-account credentials in this Flutter project. Keep them as backend secrets.

For the full architecture and server-side lifecycle, see [`../../docs/mobile.md`](../../docs/mobile.md).
