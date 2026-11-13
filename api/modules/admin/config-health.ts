import type { WorkerEnv } from '../../env';

export type ConfigurationStatus = 'ready' | 'incomplete' | 'error' | 'disabled';

export interface ConfigurationCheck {
  id: string;
  name: string;
  status: ConfigurationStatus;
  summary: string;
  notes: string[];
}

export interface ConfigurationHealthReport {
  environment: string;
  checkedAt: string;
  checks: ConfigurationCheck[];
}

type ConfigEnv = WorkerEnv & {
  GOOGLE_PUBSUB_AUDIENCE?: string;
  GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL?: string;
};

function hasValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function appUrlIssue(value: string | undefined, environment: string): string | null {
  if (!hasValue(value)) return 'Falta la URL base de la aplicación.';
  try {
    const url = new URL(value);
    if (url.username || url.password) return 'La URL base no debe incluir credenciales.';
    if (url.protocol !== 'https:' && !(environment === 'development' && url.protocol === 'http:')) {
      return 'La URL debe usar HTTPS fuera del entorno local.';
    }
    return null;
  } catch {
    return 'La URL base no tiene un formato válido.';
  }
}

function check(
  id: string,
  name: string,
  status: ConfigurationStatus,
  summary: string,
  notes: string[] = [],
): ConfigurationCheck {
  return { id, name, status, summary, notes };
}

function secretCheck(value: string | undefined, missingSummary: string, readySummary: string): ConfigurationCheck {
  if (!hasValue(value)) return check('tenant-context', 'JWT de tenant activo', 'incomplete', missingSummary);
  if (new TextEncoder().encode(value).byteLength < 32) {
    return check('tenant-context', 'JWT de tenant activo', 'error', 'El secreto configurado es demasiado corto.', [
      'Usa un valor aleatorio de al menos 32 bytes y distinto al secreto de Better Auth.',
    ]);
  }
  return check('tenant-context', 'JWT de tenant activo', 'ready', readySummary, [
    'La revisión comprueba presencia y longitud; no revela ni prueba el secreto.',
  ]);
}

function pairCheck(
  id: string,
  name: string,
  first: string | undefined,
  second: string | undefined,
  firstLabel: string,
  secondLabel: string,
): ConfigurationCheck {
  const hasFirst = hasValue(first);
  const hasSecond = hasValue(second);
  if (!hasFirst && !hasSecond) return check(id, name, 'disabled', 'Integración deshabilitada: no hay credenciales configuradas.');
  if (hasFirst !== hasSecond) {
    return check(id, name, 'incomplete', 'Falta completar la configuración.', [
      `${hasFirst ? secondLabel : firstLabel} todavía no está configurado.`,
    ]);
  }
  return check(id, name, 'ready', 'Configuración presente; no se verificó conexión con el proveedor.');
}

function workerBindings(env: ConfigEnv): ConfigurationCheck {
  const missing = [
    ['DB', env.DB],
    ['FILES', env.FILES],
    ['API_RATE_LIMITER', env.API_RATE_LIMITER],
    ['AUTH_RATE_LIMITER', env.AUTH_RATE_LIMITER],
  ].filter(([, value]) => value === undefined || value === null).map(([name]) => String(name));
  if (missing.length) {
    return check('cloudflare', 'Bindings de Cloudflare', 'incomplete', 'Faltan recursos obligatorios.', [
      `Bindings ausentes: ${missing.join(', ')}.`,
    ]);
  }
  return check('cloudflare', 'Bindings de Cloudflare', 'ready', 'D1, R2 y limitadores están enlazados al Worker.', [
    'Solo se comprueba que los bindings estén disponibles; no se hacen consultas ni escrituras.',
  ]);
}

function authCheck(env: ConfigEnv): ConfigurationCheck {
  const issues: string[] = [];
  let incomplete = false;
  if (!hasValue(env.BETTER_AUTH_SECRET)) incomplete = true;
  else if (new TextEncoder().encode(env.BETTER_AUTH_SECRET).byteLength < 32) issues.push('El secreto de Better Auth tiene menos de 32 bytes.');

  const urlIssue = appUrlIssue(env.BETTER_AUTH_URL, env.APP_ENV);
  if (urlIssue === 'Falta la URL base de la aplicación.') incomplete = true;
  else if (urlIssue) issues.push(urlIssue);

  const trustedOrigins = env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];
  for (const origin of trustedOrigins) {
    try {
      const parsed = new URL(origin);
      const allowedProtocol = parsed.protocol === 'https:' || (env.APP_ENV === 'development' && parsed.protocol === 'http:');
      if (!allowedProtocol || parsed.username || parsed.password || parsed.origin !== origin) {
        issues.push('BETTER_AUTH_TRUSTED_ORIGINS debe contener orígenes exactos y usar HTTPS fuera de desarrollo.');
        break;
      }
    } catch {
      issues.push('BETTER_AUTH_TRUSTED_ORIGINS contiene un origen con formato inválido.');
      break;
    }
  }

  if (issues.length) return check('auth', 'Identidad · Better Auth', 'error', 'Hay valores de configuración inválidos.', issues);
  if (incomplete) return check('auth', 'Identidad · Better Auth', 'incomplete', 'Falta completar la configuración requerida.', [
    ...(!hasValue(env.BETTER_AUTH_SECRET) ? ['Configura BETTER_AUTH_SECRET con al menos 32 bytes.'] : []),
    ...(!hasValue(env.BETTER_AUTH_URL) ? ['Configura BETTER_AUTH_URL para este entorno.'] : []),
  ]);
  return check('auth', 'Identidad · Better Auth', 'ready', 'URL y secreto requeridos están configurados.', [
    'No se valida aquí la base de datos de sesiones ni el estado de migraciones.',
  ]);
}

function openRouterCheck(env: ConfigEnv): ConfigurationCheck {
  if (!hasValue(env.OPENROUTER_API_KEY)) return check('openrouter', 'IA · OpenRouter', 'disabled', 'Integración deshabilitada: falta la API key.');
  return check('openrouter', 'IA · OpenRouter', 'ready', 'API key presente; no se llamó a OpenRouter.');
}

function stripeCheck(env: ConfigEnv): ConfigurationCheck {
  const hasSecret = hasValue(env.STRIPE_SECRET_KEY);
  const hasWebhook = hasValue(env.STRIPE_WEBHOOK_SECRET);
  if (!hasSecret && !hasWebhook) return check('stripe', 'Pagos web · Stripe', 'disabled', 'Integración deshabilitada: no hay credenciales configuradas.');
  if (!hasSecret || !hasWebhook) return check('stripe', 'Pagos web · Stripe', 'incomplete', 'Falta completar la configuración.', [
    ...(!hasSecret ? ['Falta STRIPE_SECRET_KEY.'] : []),
    ...(!hasWebhook ? ['Falta STRIPE_WEBHOOK_SECRET.'] : []),
  ]);
  const baseUrl = env.APP_BASE_URL ?? env.BETTER_AUTH_URL;
  const urlIssue = appUrlIssue(baseUrl, env.APP_ENV);
  if (urlIssue) return check('stripe', 'Pagos web · Stripe', 'error', 'La URL de retorno no es válida.', [urlIssue]);
  return check('stripe', 'Pagos web · Stripe', 'ready', 'Credenciales y URL de retorno presentes; no se llamó a Stripe.');
}

function googlePlayChecks(env: ConfigEnv): ConfigurationCheck[] {
  const hasPackage = hasValue(env.GOOGLE_PLAY_PACKAGE_NAME);
  const hasServiceAccount = hasValue(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
  const hasAudience = hasValue(env.GOOGLE_PUBSUB_AUDIENCE);
  const hasPubSubEmail = hasValue(env.GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL);
  const anyConfigured = hasPackage || hasServiceAccount || hasAudience || hasPubSubEmail;

  let purchaseCheck: ConfigurationCheck;
  if (!anyConfigured) {
    purchaseCheck = check('google-play', 'Pagos móviles · Google Play', 'disabled', 'Integración deshabilitada: no hay configuración.');
  } else if (!hasPackage || !hasServiceAccount) {
    purchaseCheck = check('google-play', 'Pagos móviles · Google Play', 'incomplete', 'Falta completar la verificación de compras.', [
      ...(!hasPackage ? ['Falta GOOGLE_PLAY_PACKAGE_NAME.'] : []),
      ...(!hasServiceAccount ? ['Falta la cuenta de servicio de Google Play.'] : []),
    ]);
  } else {
    let account: unknown;
    try {
      account = JSON.parse(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON!);
    } catch {
      purchaseCheck = check('google-play', 'Pagos móviles · Google Play', 'error', 'La cuenta de servicio no contiene JSON válido.');
      return [purchaseCheck, pubSubCheck(env, hasPackage, hasAudience, hasPubSubEmail)];
    }
    if (!account || typeof account !== 'object'
      || !hasValue((account as Record<string, unknown>).client_email as string | undefined)
      || !hasValue((account as Record<string, unknown>).private_key as string | undefined)) {
      purchaseCheck = check('google-play', 'Pagos móviles · Google Play', 'error', 'Faltan campos requeridos en la cuenta de servicio.');
    } else {
      purchaseCheck = check('google-play', 'Pagos móviles · Google Play', 'ready', 'Paquete y cuenta de servicio configurados; no se llamó a Google Play.');
    }
  }

  return [purchaseCheck, pubSubCheck(env, hasPackage, hasAudience, hasPubSubEmail)];
}

function pubSubCheck(env: ConfigEnv, hasPackage: boolean, hasAudience: boolean, hasEmail: boolean): ConfigurationCheck {
  if (!hasAudience && !hasEmail) return check('google-play-rtdn', 'Notificaciones Google Play · Pub/Sub', 'disabled', 'Notificaciones en tiempo real deshabilitadas.');
  if (!hasAudience || !hasEmail || !hasPackage) {
    return check('google-play-rtdn', 'Notificaciones Google Play · Pub/Sub', 'incomplete', 'Falta completar la autenticación de notificaciones.', [
      ...(!hasAudience ? ['Falta la audiencia OIDC.'] : []),
      ...(!hasEmail ? ['Falta el email de la cuenta de servicio de Pub/Sub.'] : []),
      ...(!hasPackage ? ['Configura primero el paquete de Google Play.'] : []),
    ]);
  }
  try {
    const audience = new URL(env.GOOGLE_PUBSUB_AUDIENCE!);
    if (audience.protocol !== 'https:' || audience.username || audience.password) throw new Error();
  } catch {
    return check('google-play-rtdn', 'Notificaciones Google Play · Pub/Sub', 'error', 'La audiencia OIDC debe ser una URL HTTPS válida.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL!)) {
    return check('google-play-rtdn', 'Notificaciones Google Play · Pub/Sub', 'error', 'El email de la cuenta de servicio no tiene un formato válido.');
  }
  return check('google-play-rtdn', 'Notificaciones Google Play · Pub/Sub', 'ready', 'Audiencia y cuenta de servicio configuradas; no se verificó Pub/Sub.');
}

export function buildConfigurationHealthReport(env: ConfigEnv): ConfigurationHealthReport {
  const resend = pairCheck('resend', 'Correo · Resend', env.RESEND_API_KEY, env.RESEND_FROM, 'RESEND_API_KEY', 'RESEND_FROM');
  const googleOAuthBase = pairCheck('google-oauth', 'Inicio de sesión · Google OAuth', env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');
  const googleOAuth = googleOAuthBase.status === 'ready'
    ? check(googleOAuthBase.id, googleOAuthBase.name, 'incomplete', 'Credenciales configuradas, pero la verificación de email del proveedor no se exige explícitamente.', [
      'Activa requireEmailVerification en la configuración del proveedor para exigir un email de Google verificado.',
    ])
    : googleOAuthBase;
  const emailVerification = hasValue(env.RESEND_API_KEY) && hasValue(env.RESEND_FROM)
    ? check('email-verification', 'Verificación de email y recuperación de contraseña', 'ready', 'Resend está configurado para verificar nuevas cuentas y enviar recuperación.')
    : env.APP_ENV === 'development'
      ? check('email-verification', 'Verificación de email y recuperación de contraseña', 'disabled', 'Deshabilitada en local porque Resend no está configurado.')
      : check('email-verification', 'Verificación de email y recuperación de contraseña', 'error', 'El registro por email/password no verifica que la persona controle el correo.', [
        'Configura RESEND_API_KEY y RESEND_FROM, o deshabilita email/password fuera de desarrollo.',
      ]);
  const tenantContext = secretCheck(
    env.TENANT_CONTEXT_SECRET,
    'Falta TENANT_CONTEXT_SECRET.',
    'Secreto con longitud mínima configurada.',
  );

  return {
    environment: env.APP_ENV,
    checkedAt: new Date().toISOString(),
    checks: [
      workerBindings(env),
      authCheck(env),
      tenantContext,
      emailVerification,
      check('permissions-admin', 'Permisos y administración', env.DB ? 'ready' : 'incomplete', env.DB
        ? 'Módulo base disponible; el acceso admin requiere tenant activo y admin.manage.'
        : 'Falta el binding D1 requerido.'),
      check('quotas', 'Gestor de cuotas', env.DB ? 'ready' : 'incomplete', env.DB
        ? 'Binding D1 presente; el estado de migraciones no se comprueba.'
        : 'Falta el binding D1 requerido.'),
      googleOAuth,
      resend,
      openRouterCheck(env),
      stripeCheck(env),
      ...googlePlayChecks(env),
    ],
  };
}
