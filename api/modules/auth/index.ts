import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sendEmail } from '../email/resend';
import { drizzle } from 'drizzle-orm/d1';
import type { WorkerEnv } from '../../env';
import { ensurePersonalTenant } from '../tenants/storage';
import { authSchema } from './schema';

export interface AuthBindings extends WorkerEnv {
  APP_NAME?: string;
}

function requiredSecret(env: AuthBindings): string {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error('BETTER_AUTH_SECRET must be at least 32 bytes.');
  }
  return secret;
}

function resolveBaseUrl(env: AuthBindings): string {
  const value = env.BETTER_AUTH_URL?.trim();
  if (!value) throw new Error('BETTER_AUTH_URL must be configured for this environment.');
  const url = new URL(value);
  if (url.protocol !== 'https:' && env.APP_ENV !== 'development') {
    throw new Error('BETTER_AUTH_URL must use HTTPS outside local development.');
  }
  return url.origin;
}

function trustedOrigins(env: AuthBindings, baseUrl: string): string[] {
  const configured = env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];
  return [...new Set([baseUrl, ...configured])];
}

export function createAuth(env: AuthBindings) {
  const secret = requiredSecret(env);
  const baseURL = resolveBaseUrl(env);
  const hasGoogleId = Boolean(env.GOOGLE_CLIENT_ID?.trim());
  const hasGoogleSecret = Boolean(env.GOOGLE_CLIENT_SECRET?.trim());
  const hasResend = Boolean(env.RESEND_API_KEY?.trim() && env.RESEND_FROM?.trim());
  if (hasGoogleId !== hasGoogleSecret) {
    throw new Error('Configure both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable Google OAuth.');
  }

  const database = drizzle(env.DB, { schema: authSchema });

  return betterAuth({
    appName: env.APP_NAME?.trim() || 'Cloudflare Apps',
    baseURL,
    basePath: '/api/auth',
    secret,
    trustedOrigins: trustedOrigins(env, baseURL),
    database: drizzleAdapter(database, { provider: 'sqlite', schema: authSchema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: hasResend,
      ...(hasResend ? {
        sendResetPassword: async ({ user, url }: { user: { email: string; name: string }; url: string }) => {
          await sendEmail(env, {
            to: user.email,
            subject: 'Restablece tu contraseña',
            text: `Hola ${user.name}, abre este enlace para cambiar tu contraseña: ${url}`,
          });
        },
      } : {}),
    },
    ...(hasResend ? {
      emailVerification: {
        sendOnSignUp: true,
        autoSignInAfterVerification: true,
        sendVerificationEmail: async ({ user, url }: { user: { email: string; name: string }; url: string }) => {
          await sendEmail(env, {
            to: user.email,
            subject: 'Verifica tu correo',
            text: `Hola ${user.name}, verifica tu correo abriendo este enlace: ${url}`,
          });
        },
      },
    } : {}),
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // Idempotent data provisioning; schema creation is handled only by D1 migrations.
            await ensurePersonalTenant(env.DB, { id: user.id, name: user.name });
          },
        },
      },
    },
    ...(hasGoogleId && hasGoogleSecret ? {
      socialProviders: {
        google: {
          clientId: env.GOOGLE_CLIENT_ID!,
          clientSecret: env.GOOGLE_CLIENT_SECRET!,
        },
      },
    } : {}),
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // Keep each request tied to the persisted session so revocation is immediate.
      cookieCache: { enabled: false },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      useSecureCookies: baseURL.startsWith('https://'),
    },
  });
}

export type AuthInstance = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<AuthInstance['api']['getSession']>>>;

export async function getAuthSession(env: AuthBindings, headers: Headers): Promise<AuthSession | null> {
  try {
    return await createAuth(env).api.getSession({
      headers,
      query: { disableCookieCache: true },
    });
  } catch (error) {
    console.error('Better Auth session lookup failed', error);
    return null;
  }
}

export function createAuthHandler(env: AuthBindings): (request: Request) => Promise<Response> {
  const auth = createAuth(env);
  return (request) => auth.handler(request);
}
