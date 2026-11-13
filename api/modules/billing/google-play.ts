import { importPKCS8, importX509, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

const serviceAccountSchema = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
  token_uri: z.string().url().optional(),
});

const oauthTokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive().optional() });

const subscriptionSchema = z.object({
  subscriptionState: z.string(),
  lineItems: z.array(z.object({ productId: z.string(), expiryTime: z.string().optional() })).default([]),
});

export class GooglePlayUnavailableError extends Error {
  constructor(message = 'Google Play verification is unavailable') {
    super(message);
    this.name = 'GooglePlayUnavailableError';
  }
}

export interface VerifiedPlaySubscription {
  state: string;
  productId: string;
  expiryTime: string | null;
  active: boolean;
}

export async function createGooglePlayAccessToken(serviceAccountJson: string): Promise<string> {
  let serviceAccount: z.infer<typeof serviceAccountSchema>;
  try {
    serviceAccount = serviceAccountSchema.parse(JSON.parse(serviceAccountJson));
  } catch {
    throw new GooglePlayUnavailableError('Google Play service account secret is invalid');
  }

  const tokenUri = serviceAccount.token_uri ?? 'https://oauth2.googleapis.com/token';
  if (new URL(tokenUri).origin !== 'https://oauth2.googleapis.com') {
    throw new GooglePlayUnavailableError('Google OAuth token endpoint is not trusted');
  }

  let privateKey: CryptoKey;
  try {
    privateKey = await importPKCS8(serviceAccount.private_key.replace(/\\n/g, '\n'), 'RS256');
  } catch {
    throw new GooglePlayUnavailableError('Google Play service account private key is invalid');
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/androidpublisher' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(serviceAccount.client_email)
    .setAudience(tokenUri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) throw new GooglePlayUnavailableError('Google OAuth token exchange failed');

  try {
    return oauthTokenSchema.parse(await response.json()).access_token;
  } catch {
    throw new GooglePlayUnavailableError('Google OAuth returned an invalid response');
  }
}

/** Verifies authenticated Pub/Sub OIDC push identity, audience, signature, and email. */
export async function verifyGooglePubSubPushToken(
  token: string,
  expected: { audience: string; serviceAccountEmail: string },
): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3 || !expected.audience || !expected.serviceAccountEmail) return false;
  let keyId: string;
  try {
    const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false;
    keyId = header.kid;
  } catch {
    return false;
  }

  let certificates: Record<string, string>;
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v1/certs');
    if (!response.ok) return false;
    certificates = z.record(z.string(), z.string()).parse(await response.json());
  } catch {
    return false;
  }
  const certificate = certificates[keyId];
  if (!certificate) return false;

  try {
    const publicKey = await importX509(certificate, 'RS256');
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['RS256'],
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: expected.audience,
      maxTokenAge: '10 minutes',
      clockTolerance: 60,
    });
    return payload.email === expected.serviceAccountEmail
      && (payload.email_verified === true || payload.email_verified === 'true');
  } catch {
    return false;
  }
}

export async function verifyGooglePlaySubscription(
  input: {
    packageName: string;
    productId: string;
    purchaseToken: string;
    serviceAccountJson: string;
  },
): Promise<VerifiedPlaySubscription | null> {
  const accessToken = await createGooglePlayAccessToken(input.serviceAccountJson);
  const endpoint = new URL(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(input.packageName)}`
      + `/purchases/subscriptionsv2/tokens/${encodeURIComponent(input.purchaseToken)}`,
  );
  const response = await fetch(endpoint, { headers: { authorization: `Bearer ${accessToken}` } });
  if ([400, 404, 410].includes(response.status)) return null;
  if (!response.ok) throw new GooglePlayUnavailableError('Google Play Developer API request failed');

  let purchase: z.infer<typeof subscriptionSchema>;
  try {
    purchase = subscriptionSchema.parse(await response.json());
  } catch {
    throw new GooglePlayUnavailableError('Google Play returned an invalid purchase response');
  }

  const lineItem = purchase.lineItems.find((item) => item.productId === input.productId);
  if (!lineItem) return null;

  const expiryMs = lineItem.expiryTime ? Date.parse(lineItem.expiryTime) : Number.NaN;
  const hasNotExpired = Number.isFinite(expiryMs) && expiryMs > Date.now();
  const activeState = ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED']
    .includes(purchase.subscriptionState);

  return {
    state: purchase.subscriptionState,
    productId: lineItem.productId,
    expiryTime: Number.isFinite(expiryMs) ? new Date(expiryMs).toISOString() : null,
    active: activeState && hasNotExpired,
  };
}
