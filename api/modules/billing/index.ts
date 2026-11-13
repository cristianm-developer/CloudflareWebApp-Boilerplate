import { Hono } from 'hono';
import { z } from 'zod';
import { quotaKeySchema, quotaPeriodSchema } from '@boilerplate/contracts';
import type { WorkerEnv } from '../../env';
import { requireTenantPermission, tenantContextMiddleware, type ActiveTenantContext, type TenantContextVariables } from '../tenants';
import { GooglePlayUnavailableError, verifyGooglePlaySubscription, verifyGooglePubSubPushToken } from './google-play';
import { verifyStripeSignature } from './stripe';

interface BillingBindings extends WorkerEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  GOOGLE_PLAY_PACKAGE_NAME?: string;
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_PUBSUB_AUDIENCE?: string;
  GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL?: string;
}

type BillingHonoEnv = {
  Bindings: BillingBindings;
  Variables: TenantContextVariables;
};

interface PlanRow {
  plan_key: string;
  display_name: string;
  rank: number;
  provider: 'stripe' | 'google-play';
  provider_reference: string;
  status: BillingStatus;
  current_period_end: string | null;
}

interface PlanQuotaRow {
  quota_key: string;
  period: 'daily' | 'weekly' | 'monthly';
  limit_value: number | null;
}

type BillingStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'expired' | 'revoked' | 'pending';

export interface TenantPlanResolution {
  plan: { key: string; name: string; rank: number } | null;
  entitlements: Array<{
    provider: PlanRow['provider'];
    reference: string;
    status: BillingStatus;
    currentPeriodEnd: string | null;
  }>;
  quotas: Array<{ quotaKey: string; period: PlanQuotaRow['period']; limit: number | null }>;
}

export function resolveAppBaseUrl(env: Pick<BillingBindings, 'APP_BASE_URL' | 'BETTER_AUTH_URL' | 'APP_ENV'>): URL | null {
  try {
    const baseUrl = new URL(env.APP_BASE_URL ?? env.BETTER_AUTH_URL ?? '');
    if (baseUrl.username || baseUrl.password) return null;
    if (baseUrl.protocol !== 'https:' && !(baseUrl.protocol === 'http:' && env.APP_ENV === 'development')) return null;
    return baseUrl;
  } catch {
    return null;
  }
}

export async function readBoundedRequestText(request: Request, maxBytes: number): Promise<{ text: string; tooLarge: boolean }> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return { text: '', tooLarge: true };
  if (!request.body) return { text: '', tooLarge: false };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { text: '', tooLarge: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), tooLarge: false };
}

const playVerificationSchema = z.object({
  productId: z.string().min(1).max(200),
  purchaseToken: z.string().min(20).max(4096),
});

const stripeCheckoutSchema = z.object({
  productId: z.string().min(1).max(200),
});

const stripeCheckoutResponseSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
});

const stripeEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  created: z.number().int().nonnegative(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

const pubsubPushSchema = z.object({
  message: z.object({ data: z.string().min(1), messageId: z.string().min(1) }),
  subscription: z.string().optional(),
});

const playRtdnSchema = z.object({
  packageName: z.string(),
  subscriptionNotification: z.object({
    purchaseToken: z.string().min(20).max(4096),
    subscriptionId: z.string().min(1),
    notificationType: z.number().int(),
  }).optional(),
});

/** Resolve the effective paid plan and active provider entitlements for a verified tenant context. */
export async function resolveTenantPlan(db: D1Database, tenant: ActiveTenantContext, now = new Date()): Promise<TenantPlanResolution> {
  const entitlements = await loadActiveEntitlements(db, tenant.tenantId, now);
  const winner = entitlements[0];
  if (!winner) return { plan: null, entitlements: [], quotas: [] };

  const quotaRows = await db.prepare(`
    SELECT quota_key, period, limit_value FROM billing_plan_quotas WHERE plan_key = ? ORDER BY quota_key
  `).bind(winner.plan_key).all<PlanQuotaRow>();

  return {
    plan: { key: winner.plan_key, name: winner.display_name, rank: winner.rank },
    entitlements: entitlements.map((row) => ({
      provider: row.provider,
      reference: row.provider_reference,
      status: row.status,
      currentPeriodEnd: row.current_period_end,
    })),
    quotas: (quotaRows.results ?? []).map((row) => ({
      quotaKey: row.quota_key,
      period: row.period,
      limit: row.limit_value,
    })),
  };
}

/** Reconcile plan-derived policies only; manually provisioned/add-on policies are preserved. */
export async function syncTenantQuotaPolicies(db: D1Database, tenant: ActiveTenantContext, now = new Date()): Promise<TenantPlanResolution> {
  return syncQuotaPoliciesForTrustedTenantId(db, tenant.tenantId, now);
}

async function syncQuotaPoliciesForTrustedTenantId(db: D1Database, tenantId: string, now: Date): Promise<TenantPlanResolution> {
  const rows = await loadActiveEntitlements(db, tenantId, now);
  const winner = rows[0];
  const quotas = winner
    ? (await db.prepare('SELECT quota_key, period, limit_value FROM billing_plan_quotas WHERE plan_key = ? ORDER BY quota_key')
      .bind(winner.plan_key).all<PlanQuotaRow>()).results ?? []
    : [];

  const statements: D1PreparedStatement[] = [db.prepare(
    "DELETE FROM tenant_quota_policies WHERE tenant_id = ? AND source = 'plan'",
  ).bind(tenantId)];
  for (const quota of quotas) {
    const validated = quotaKeySchema.safeParse(quota.quota_key);
    const validPeriod = quotaPeriodSchema.safeParse(quota.period);
    if (!validated.success || !validPeriod.success) throw new Error('Stored plan quota policy is invalid');
    statements.push(db.prepare(`
      INSERT INTO tenant_quota_policies (tenant_id, quota_key, period, limit_value, source)
      VALUES (?, ?, ?, ?, 'plan')
      ON CONFLICT (tenant_id, quota_key) DO UPDATE SET
        period = excluded.period,
        limit_value = excluded.limit_value,
        source = 'plan',
        updated_at = datetime('now')
      WHERE tenant_quota_policies.source = 'plan'
    `).bind(tenantId, quota.quota_key, quota.period, quota.limit_value));
  }
  await db.batch(statements);

  if (!winner) return { plan: null, entitlements: [], quotas: [] };
  const activeEntitlements = rows.map((row) => ({
    provider: row.provider,
    reference: row.provider_reference,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
  }));
  return {
    plan: { key: winner.plan_key, name: winner.display_name, rank: winner.rank },
    entitlements: activeEntitlements,
    quotas: quotas.map((row) => ({ quotaKey: row.quota_key, period: row.period, limit: row.limit_value })),
  };
}

export async function persistStripeSubscriptionEvent(
  db: D1Database,
  event: { id: string; type: string; created: number },
  input: { tenantId: string; subscriptionId: string; planKey: string; status: BillingStatus; currentPeriodEnd: string | null },
  reconcile: (database: D1Database, tenantId: string, now: Date) => Promise<unknown> = syncQuotaPoliciesForTrustedTenantId,
): Promise<void> {
  await db.prepare(`
    INSERT INTO billing_entitlements (tenant_id, provider, provider_reference, plan_key, status, current_period_end, provider_event_created)
    VALUES (?, 'stripe', ?, ?, ?, ?, ?)
    ON CONFLICT (tenant_id, provider, provider_reference) DO UPDATE SET
      plan_key = excluded.plan_key,
      status = excluded.status,
      current_period_end = excluded.current_period_end,
      provider_event_created = excluded.provider_event_created,
      updated_at = datetime('now')
    WHERE billing_entitlements.provider_event_created IS NULL
      OR excluded.provider_event_created >= billing_entitlements.provider_event_created
  `).bind(input.tenantId, input.subscriptionId, input.planKey, input.status, input.currentPeriodEnd, event.created).run();
  await reconcile(db, input.tenantId, new Date());
  await db.prepare('INSERT OR IGNORE INTO billing_stripe_events (event_id, event_type) VALUES (?, ?)')
    .bind(event.id, event.type).run();
}

async function loadActiveEntitlements(db: D1Database, tenantId: string, now: Date): Promise<PlanRow[]> {
  const result = await db.prepare(`
    SELECT e.plan_key, p.display_name, p.rank, e.provider, e.provider_reference, e.status, e.current_period_end
    FROM billing_entitlements e
    JOIN billing_plans p ON p.plan_key = e.plan_key AND p.active = 1
    WHERE e.tenant_id = ?
      AND e.status IN ('active', 'trialing')
      AND (e.current_period_end IS NULL OR e.current_period_end > ?)
    ORDER BY p.rank DESC, e.plan_key ASC, e.provider ASC
  `).bind(tenantId, now.toISOString()).all<PlanRow>();
  return result.results ?? [];
}

async function hashPurchaseToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function getOrCreateStripeCustomer(
  db: D1Database,
  secret: string,
  tenantId: string,
  email: string,
  name: string,
): Promise<{ customerId: string; failure: false } | { customerId: ''; failure: true }> {
  const existing = await db.prepare(`
    SELECT provider_customer_id FROM billing_customers WHERE provider = 'stripe' AND tenant_id = ?
  `).bind(tenantId).first<{ provider_customer_id: string }>();
  if (existing) return { customerId: existing.provider_customer_id, failure: false };

  const form = new URLSearchParams({
    email,
    name,
    'metadata[tenant_id]': tenantId,
  });
  const response = await fetchWithTimeout('https://api.stripe.com/v1/customers', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `tenant-customer-${tenantId}`,
    },
    body: form,
  });
  if (!response.ok) return { customerId: '', failure: true };
  const customer = z.object({ id: z.string().min(1) }).safeParse(await response.json().catch(() => null));
  if (!customer.success) return { customerId: '', failure: true };

  await db.prepare(`
    INSERT INTO billing_customers (provider, provider_customer_id, tenant_id)
    VALUES ('stripe', ?, ?)
    ON CONFLICT (provider, tenant_id) DO NOTHING
  `).bind(customer.data.id, tenantId).run();
  const linked = await db.prepare(`
    SELECT provider_customer_id FROM billing_customers WHERE provider = 'stripe' AND tenant_id = ?
  `).bind(tenantId).first<{ provider_customer_id: string }>();
  return linked
    ? { customerId: linked.provider_customer_id, failure: false }
    : { customerId: '', failure: true };
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', onAbort);
  }
}

async function applyGooglePlayPurchase(
  env: BillingBindings,
  input: { tenantId: string; userId: string; productId: string; purchaseToken: string },
): Promise<{ active: boolean; planKey: string; expiryTime: string | null; state: string; tokenHash: string } | null> {
  if (!env.GOOGLE_PLAY_PACKAGE_NAME || !env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) throw new GooglePlayUnavailableError();
  const product = await env.DB.prepare(`
    SELECT bp.plan_key FROM billing_products bp JOIN billing_plans p ON p.plan_key = bp.plan_key
    WHERE bp.provider = 'google-play' AND bp.product_id = ? AND bp.active = 1 AND p.active = 1
  `).bind(input.productId).first<{ plan_key: string }>();
  if (!product) return null;

  const verified = await verifyGooglePlaySubscription({
    packageName: env.GOOGLE_PLAY_PACKAGE_NAME,
    productId: input.productId,
    purchaseToken: input.purchaseToken,
    serviceAccountJson: env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
  });
  if (!verified) return null;

  const tokenHash = await hashPurchaseToken(input.purchaseToken);
  // Reserve this private token's tenant/user association before entitlement writes. Token is never stored.
  await env.DB.prepare(`
    INSERT INTO billing_google_play_purchases (token_hash, user_id, tenant_id, product_id, plan_key, expiry_time, state)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (token_hash) DO NOTHING
  `).bind(tokenHash, input.userId, input.tenantId, input.productId, product.plan_key, verified.expiryTime, verified.state).run();
  const owner = await env.DB.prepare(`
    SELECT user_id, tenant_id, product_id FROM billing_google_play_purchases WHERE token_hash = ?
  `).bind(tokenHash).first<{ user_id: string; tenant_id: string; product_id: string }>();
  if (!owner || owner.user_id !== input.userId || owner.tenant_id !== input.tenantId || owner.product_id !== input.productId) {
    throw new Error('PURCHASE_ALREADY_LINKED');
  }

  const status: BillingStatus = verified.active ? 'active'
    : verified.state.includes('EXPIRED') ? 'expired'
      : verified.state.includes('REVOKED') ? 'revoked' : 'pending';
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE billing_google_play_purchases SET plan_key = ?, expiry_time = ?, state = ?, updated_at = datetime('now')
      WHERE token_hash = ? AND user_id = ? AND tenant_id = ?
    `).bind(product.plan_key, verified.expiryTime, verified.state, tokenHash, input.userId, input.tenantId),
    env.DB.prepare(`
      INSERT INTO billing_entitlements (tenant_id, provider, provider_reference, plan_key, status, current_period_end)
      VALUES (?, 'google-play', ?, ?, ?, ?)
      ON CONFLICT (tenant_id, provider, provider_reference) DO UPDATE SET
        plan_key = excluded.plan_key,
        status = excluded.status,
        current_period_end = excluded.current_period_end,
        updated_at = datetime('now')
    `).bind(input.tenantId, tokenHash, product.plan_key, status, verified.expiryTime),
  ]);
  await syncQuotaPoliciesForTrustedTenantId(env.DB, input.tenantId, new Date());
  return { active: verified.active, planKey: product.plan_key, expiryTime: verified.expiryTime, state: verified.state, tokenHash };
}

const protectedBillingRoutes = new Hono<BillingHonoEnv>();
protectedBillingRoutes.use('*', tenantContextMiddleware());
protectedBillingRoutes.get('/plans', async (context) => {
  const result = await context.env.DB.prepare(`
    SELECT bp.provider, bp.product_id, bp.plan_key, p.display_name, p.rank
    FROM billing_products bp
    JOIN billing_plans p ON p.plan_key = bp.plan_key
    WHERE bp.active = 1 AND p.active = 1
    ORDER BY p.rank ASC, p.plan_key ASC, bp.provider ASC
  `).all();
  return context.json({ plans: result.results ?? [] });
});

protectedBillingRoutes.post('/stripe/checkout', requireTenantPermission('billing.manage'), async (context) => {
  const secret = context.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) return context.json({ error: 'STRIPE_NOT_CONFIGURED' }, 503);
  const input = stripeCheckoutSchema.safeParse(await context.req.json().catch(() => null));
  if (!input.success) return context.json({ error: 'INVALID_CHECKOUT_REQUEST' }, 400);

  const tenant = context.get('tenantContext');
  const session = context.get('authSession');
  const product = await context.env.DB.prepare(`
    SELECT bp.product_id FROM billing_products bp
    JOIN billing_plans p ON p.plan_key = bp.plan_key
    WHERE bp.provider = 'stripe' AND bp.product_id = ? AND bp.active = 1 AND p.active = 1
  `).bind(input.data.productId).first<{ product_id: string }>();
  if (!product) return context.json({ error: 'PLAN_NOT_AVAILABLE' }, 404);

  const baseUrl = resolveAppBaseUrl(context.env);
  if (!baseUrl) return context.json({ error: 'APP_BASE_URL_NOT_CONFIGURED' }, 503);

  try {
    const { customerId, failure } = await getOrCreateStripeCustomer(
      context.env.DB, secret, tenant.tenantId, session.user.email, session.user.name,
    );
    if (failure) return context.json({ error: 'STRIPE_CUSTOMER_UNAVAILABLE' }, 503);

    const form = new URLSearchParams({
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': product.product_id,
      'line_items[0][quantity]': '1',
      success_url: new URL('/app?billing=success&session_id={CHECKOUT_SESSION_ID}', baseUrl).toString(),
      cancel_url: new URL('/app?billing=cancelled', baseUrl).toString(),
      'metadata[tenant_id]': tenant.tenantId,
      'subscription_data[metadata][tenant_id]': tenant.tenantId,
    });
    const response = await fetchWithTimeout('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `checkout-${tenant.tenantId}-${crypto.randomUUID()}`,
      },
      body: form,
    });
    if (!response.ok) return context.json({ error: 'STRIPE_CHECKOUT_UNAVAILABLE' }, 503);
    const checkout = stripeCheckoutResponseSchema.safeParse(await response.json().catch(() => null));
    if (!checkout.success) return context.json({ error: 'STRIPE_CHECKOUT_UNAVAILABLE' }, 503);
    return context.json({ checkoutUrl: checkout.data.url });
  } catch {
    return context.json({ error: 'STRIPE_CHECKOUT_UNAVAILABLE' }, 503);
  }
});

protectedBillingRoutes.post('/stripe/portal', requireTenantPermission('billing.manage'), async (context) => {
  const secret = context.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) return context.json({ error: 'STRIPE_NOT_CONFIGURED' }, 503);
  const tenant = context.get('tenantContext');
  const customer = await context.env.DB.prepare(`
    SELECT provider_customer_id FROM billing_customers WHERE provider = 'stripe' AND tenant_id = ?
  `).bind(tenant.tenantId).first<{ provider_customer_id: string }>();
  if (!customer) return context.json({ error: 'STRIPE_CUSTOMER_NOT_FOUND' }, 404);

  const baseUrl = resolveAppBaseUrl(context.env);
  if (!baseUrl) return context.json({ error: 'APP_BASE_URL_NOT_CONFIGURED' }, 503);
  const returnUrl = new URL('/admin', baseUrl).toString();

  try {
    const response = await fetchWithTimeout('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ customer: customer.provider_customer_id, return_url: returnUrl }),
    });
    if (!response.ok) return context.json({ error: 'STRIPE_PORTAL_UNAVAILABLE' }, 503);
    const portal = z.object({ url: z.string().url() }).safeParse(await response.json().catch(() => null));
    if (!portal.success) return context.json({ error: 'STRIPE_PORTAL_UNAVAILABLE' }, 503);
    return context.json({ portalUrl: portal.data.url });
  } catch {
    return context.json({ error: 'STRIPE_PORTAL_UNAVAILABLE' }, 503);
  }
});

protectedBillingRoutes.post('/google-play/verify', requireTenantPermission('billing.manage'), async (context) => {
  const input = playVerificationSchema.safeParse(await context.req.json().catch(() => null));
  if (!input.success) return context.json({ error: 'INVALID_PURCHASE_REQUEST' }, 400);
  const tenant = context.get('tenantContext');
  const session = context.get('authSession');

  try {
    const result = await applyGooglePlayPurchase(context.env, {
      tenantId: tenant.tenantId,
      userId: session.user.id,
      ...input.data,
    });
    if (!result) return context.json({ error: 'PURCHASE_NOT_VERIFIED' }, 422);
    if (!result.active) return context.json({ error: 'PURCHASE_NOT_ACTIVE' }, 422);
    const resolution = await resolveTenantPlan(context.env.DB, tenant);
    return context.json({
      verified: true,
      entitlement: {
        planKey: result.planKey,
        status: 'active',
        expiresAt: result.expiryTime,
        effectivePlan: resolution.plan?.key ?? result.planKey,
      },
    });
  } catch (error) {
    if (error instanceof GooglePlayUnavailableError) return context.json({ error: 'PURCHASE_VERIFICATION_UNAVAILABLE' }, 503);
    if (error instanceof Error && error.message === 'PURCHASE_ALREADY_LINKED') return context.json({ error: 'PURCHASE_ALREADY_LINKED' }, 409);
    console.error('Google Play verification failed', error);
    return context.json({ error: 'PURCHASE_VERIFICATION_UNAVAILABLE' }, 503);
  }
});

export const billingRoutes = new Hono<BillingHonoEnv>();
billingRoutes.route('/', protectedBillingRoutes);

billingRoutes.post('/stripe/webhook', async (context) => {
  const secret = context.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return context.json({ error: 'STRIPE_WEBHOOK_NOT_CONFIGURED' }, 503);
  const requestBody = await readBoundedRequestText(context.req.raw, 1_000_000);
  if (requestBody.tooLarge) return context.json({ error: 'WEBHOOK_TOO_LARGE' }, 413);
  const rawBody = requestBody.text;
  if (!await verifyStripeSignature(rawBody, context.req.header('stripe-signature') ?? null, secret)) {
    return context.json({ error: 'INVALID_WEBHOOK_SIGNATURE' }, 400);
  }

  let decodedEvent: unknown;
  try { decodedEvent = JSON.parse(rawBody); } catch { return context.json({ error: 'INVALID_WEBHOOK_EVENT' }, 400); }
  const parsed = stripeEventSchema.safeParse(decodedEvent);
  if (!parsed.success) return context.json({ error: 'INVALID_WEBHOOK_EVENT' }, 400);
  const event = parsed.data;
  const existing = await context.env.DB.prepare('SELECT event_id FROM billing_stripe_events WHERE event_id = ?')
    .bind(event.id).first<{ event_id: string }>();
  if (existing) return context.json({ received: true, duplicate: true });
  if (!event.type.startsWith('customer.subscription.')) {
    await context.env.DB.prepare('INSERT OR IGNORE INTO billing_stripe_events (event_id, event_type) VALUES (?, ?)')
      .bind(event.id, event.type).run();
    return context.json({ received: true, ignored: true });
  }

  const subscription = event.data.object;
  const subscriptionId = typeof subscription.id === 'string' ? subscription.id : '';
  const customer = typeof subscription.customer === 'string'
    ? subscription.customer
    : typeof subscription.customer === 'object' && subscription.customer !== null && 'id' in subscription.customer
      ? String(subscription.customer.id) : '';
  const statusValue = typeof subscription.status === 'string' ? subscription.status : '';
  const items = subscription.items && typeof subscription.items === 'object' && 'data' in subscription.items
    && Array.isArray(subscription.items.data) ? subscription.items.data : [];
  const firstItem = items[0] as Record<string, unknown> | undefined;
  const price = firstItem?.price && typeof firstItem.price === 'object' ? firstItem.price as Record<string, unknown> : null;
  const productId = typeof price?.id === 'string' ? price.id : '';
  const periodEnds = items.map((item) => {
    if (!item || typeof item !== 'object') return null;
    const value = (item as Record<string, unknown>).current_period_end;
    return typeof value === 'number' ? value : null;
  }).filter((value): value is number => value !== null);
  const currentPeriodEnd = periodEnds.length ? new Date(Math.max(...periodEnds) * 1000).toISOString() : null;
  if (!subscriptionId || !customer || !productId) return context.json({ error: 'INVALID_SUBSCRIPTION_EVENT' }, 400);

  const customerRow = await context.env.DB.prepare(`
    SELECT tenant_id FROM billing_customers WHERE provider = 'stripe' AND provider_customer_id = ?
  `).bind(customer).first<{ tenant_id: string }>();
  const product = await context.env.DB.prepare(`
    SELECT bp.plan_key FROM billing_products bp JOIN billing_plans p ON p.plan_key = bp.plan_key
    WHERE bp.provider = 'stripe' AND bp.product_id = ? AND bp.active = 1 AND p.active = 1
  `).bind(productId).first<{ plan_key: string }>();
  if (!customerRow || !product) return context.json({ error: 'SUBSCRIPTION_MAPPING_UNAVAILABLE' }, 503);

  const entitlementStatus: BillingStatus = event.type.endsWith('.deleted') ? 'canceled'
    : statusValue === 'active' ? 'active'
      : statusValue === 'trialing' ? 'trialing'
        : statusValue === 'past_due' ? 'past_due'
          : statusValue === 'unpaid' ? 'expired'
            : statusValue === 'paused' ? 'canceled' : 'pending';

  // Persist the event ID only after quota reconciliation succeeds. A webhook
  // retry must be able to repair entitlement-derived quota policy state.
  await persistStripeSubscriptionEvent(context.env.DB, event, {
    tenantId: customerRow.tenant_id,
    subscriptionId,
    planKey: product.plan_key,
    status: entitlementStatus,
    currentPeriodEnd,
  });
  return context.json({ received: true });
});

billingRoutes.post('/google-play/rtdn', async (context) => {
  const { GOOGLE_PUBSUB_AUDIENCE: audience, GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL: serviceAccountEmail } = context.env;
  if (!audience || !serviceAccountEmail) return context.json({ error: 'GOOGLE_PLAY_RTDN_NOT_CONFIGURED' }, 503);
  const authHeader = context.req.header('authorization') ?? '';
  const bearer = /^Bearer ([A-Za-z0-9._-]+)$/.exec(authHeader)?.[1];
  if (!bearer || !await verifyGooglePubSubPushToken(bearer, { audience, serviceAccountEmail })) {
    return context.json({ error: 'INVALID_PUBSUB_IDENTITY' }, 401);
  }

  const requestBody = await readBoundedRequestText(context.req.raw, 64_000);
  if (requestBody.tooLarge) return context.json({ error: 'WEBHOOK_TOO_LARGE' }, 413);
  const rawBody = requestBody.text;
  let envelopeValue: unknown;
  try { envelopeValue = JSON.parse(rawBody); } catch { return context.json({ error: 'INVALID_PUBSUB_ENVELOPE' }, 400); }
  const envelope = pubsubPushSchema.safeParse(envelopeValue);
  if (!envelope.success) return context.json({ error: 'INVALID_PUBSUB_ENVELOPE' }, 400);

  let notificationValue: unknown;
  try {
    const bytes = Uint8Array.from(atob(envelope.data.message.data), (character) => character.charCodeAt(0));
    notificationValue = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return context.json({ error: 'INVALID_PLAY_NOTIFICATION' }, 400);
  }
  const notification = playRtdnSchema.safeParse(notificationValue);
  if (!notification.success) return context.body(null, 204);
  if (notification.data.packageName !== context.env.GOOGLE_PLAY_PACKAGE_NAME) {
    return context.json({ error: 'PLAY_PACKAGE_MISMATCH' }, 400);
  }
  const subscription = notification.data.subscriptionNotification;
  if (!subscription) return context.body(null, 204);

  const duplicate = await context.env.DB.prepare('SELECT message_id FROM billing_google_play_notifications WHERE message_id = ?')
    .bind(envelope.data.message.messageId).first<{ message_id: string }>();
  if (duplicate) return context.body(null, 204);
  const tokenHash = await hashPurchaseToken(subscription.purchaseToken);
  const knownPurchase = await context.env.DB.prepare(`
    SELECT user_id, tenant_id, product_id FROM billing_google_play_purchases WHERE token_hash = ?
  `).bind(tokenHash).first<{ user_id: string; tenant_id: string; product_id: string }>();

  // RTDN only triggers a server-side refresh; it never grants from notification claims.
  // Unknown tokens are ignored here and may be linked by the authenticated verify endpoint.
  if (knownPurchase && knownPurchase.product_id === subscription.subscriptionId) {
    try {
      await applyGooglePlayPurchase(context.env, {
        tenantId: knownPurchase.tenant_id,
        userId: knownPurchase.user_id,
        productId: knownPurchase.product_id,
        purchaseToken: subscription.purchaseToken,
      });
    } catch (error) {
      if (error instanceof GooglePlayUnavailableError) return context.json({ error: 'PLAY_REFRESH_UNAVAILABLE' }, 503);
      console.error('Google Play RTDN refresh failed', error);
      return context.json({ error: 'PLAY_REFRESH_UNAVAILABLE' }, 503);
    }
  }

  await context.env.DB.prepare('INSERT OR IGNORE INTO billing_google_play_notifications (message_id) VALUES (?)')
    .bind(envelope.data.message.messageId).run();
  return context.body(null, 204);
});
