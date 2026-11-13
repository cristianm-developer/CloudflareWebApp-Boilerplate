import { describe, expect, it, vi } from 'vitest';
import { persistStripeSubscriptionEvent, readBoundedRequestText, resolveAppBaseUrl } from '../../../api/modules/billing';
import { verifyStripeSignature } from '../../../api/modules/billing/stripe';

async function signatureFor(body: string, secret: string, timestamp: number) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)));
  return [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('verifyStripeSignature', () => {
  const now = 1_800_000_000;
  const secret = 'whsec_test_secret';
  const body = '{"type":"customer.subscription.updated"}';

  it('accepts the expected HMAC over the exact raw request body', async () => {
    const signature = await signatureFor(body, secret, now);
    await expect(verifyStripeSignature(body, `t=${now},v1=${signature}`, secret, now)).resolves.toBe(true);
  });

  it('rejects altered bodies and timestamps outside the tolerance window', async () => {
    const signature = await signatureFor(body, secret, now);
    await expect(verifyStripeSignature(`${body} `, `t=${now},v1=${signature}`, secret, now)).resolves.toBe(false);
    await expect(verifyStripeSignature(body, `t=${now - 301},v1=${signature}`, secret, now)).resolves.toBe(false);
  });

  it('rejects missing and malformed signatures', async () => {
    await expect(verifyStripeSignature(body, null, secret, now)).resolves.toBe(false);
    await expect(verifyStripeSignature(body, `t=${now},v1=bad`, secret, now)).resolves.toBe(false);
  });

  it('accepts a valid v1 among multiple signatures for key rotation', async () => {
    const signature = await signatureFor(body, secret, now);
    await expect(verifyStripeSignature(body, `t=${now},v1=${'0'.repeat(64)},v1=${signature}`, secret, now)).resolves.toBe(true);
  });
});

describe('resolveAppBaseUrl', () => {
  it('requires HTTPS outside local development', () => {
    expect(resolveAppBaseUrl({ APP_BASE_URL: 'http://app.example.com', APP_ENV: 'production' })).toBeNull();
    expect(resolveAppBaseUrl({ APP_BASE_URL: 'http://app.example.com', APP_ENV: 'stage' })).toBeNull();
    expect(resolveAppBaseUrl({ APP_BASE_URL: 'https://app.example.com', APP_ENV: 'production' })?.origin).toBe('https://app.example.com');
  });

  it('allows local HTTP and rejects URLs with embedded credentials', () => {
    expect(resolveAppBaseUrl({ APP_BASE_URL: 'http://localhost:4321', APP_ENV: 'development' })?.origin).toBe('http://localhost:4321');
    expect(resolveAppBaseUrl({ APP_BASE_URL: 'https://user:password@app.example.com', APP_ENV: 'production' })).toBeNull();
  });
});

describe('readBoundedRequestText', () => {
  it('reads request bodies within the byte limit', async () => {
    await expect(readBoundedRequestText(new Request('https://example.com', { method: 'POST', body: 'safe' }), 4))
      .resolves.toEqual({ text: 'safe', tooLarge: false });
  });

  it('stops buffering once the byte limit is exceeded', async () => {
    const request = new Request('https://example.com', { method: 'POST', body: 'large' });
    await expect(readBoundedRequestText(request, 4)).resolves.toEqual({ text: '', tooLarge: true });
  });
});

describe('persistStripeSubscriptionEvent', () => {
  const event = { id: 'evt_123', type: 'customer.subscription.updated', created: 1_800_000_000 };
  const input = {
    tenantId: 'tenant-1',
    subscriptionId: 'sub_123',
    planKey: 'pro',
    status: 'active' as const,
    currentPeriodEnd: '2027-01-01T00:00:00.000Z',
  };

  it('marks the Stripe event processed only after quota reconciliation succeeds', async () => {
    const statements: string[] = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn().mockReturnThis(),
        run: vi.fn(async () => { statements.push(sql); }),
      })),
    } as never;
    const reconcile = vi.fn(async () => { statements.push('reconcile'); });

    await persistStripeSubscriptionEvent(db, event, input, reconcile);
    expect(statements).toHaveLength(3);
    expect(statements[1]).toBe('reconcile');
    expect(statements[2]).toContain('billing_stripe_events');
  });

  it('leaves failed reconciliation retryable by not recording the event ID', async () => {
    const statements: string[] = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn().mockReturnThis(),
        run: vi.fn(async () => { statements.push(sql); }),
      })),
    } as never;
    const reconcile = vi.fn(async () => { throw new Error('temporary D1 failure'); });

    await expect(persistStripeSubscriptionEvent(db, event, input, reconcile)).rejects.toThrow('temporary D1 failure');
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('billing_entitlements');
    expect(statements[0]).not.toContain('billing_stripe_events');
  });
});
