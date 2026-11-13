const encoder = new TextEncoder();

function decodeHex(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

/** Verify Stripe-Signature against the unmodified request body using Workers Web Crypto. */
export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!signatureHeader || !webhookSecret) return false;
  const fields = signatureHeader.split(',').map((part) => part.trim().split('=', 2));
  const timestamp = Number(fields.find(([key]) => key === 't')?.[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const signatures = fields
    .filter(([key]) => key === 'v1')
    .map(([, value]) => decodeHex(value ?? ''))
    .filter((value): value is Uint8Array => value !== null);
  if (!signatures.length) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${rawBody}`)));
  return signatures.some((candidate) => constantTimeEqual(candidate, expected));
}
