import { z } from 'zod';

export const sendEmailInputSchema = z.object({
  from: z.string().min(3).max(320).optional(),
  to: z.union([
    z.string().min(3).max(320),
    z.array(z.string().min(3).max(320)).min(1).max(50),
  ]),
  subject: z.string().min(1).max(998),
  html: z.string().max(1_000_000).optional(),
  text: z.string().max(1_000_000).optional(),
  reply_to: z.union([z.string().min(3).max(320), z.array(z.string().min(3).max(320)).max(50)]).optional(),
}).refine((email) => Boolean(email.html || email.text), {
  message: 'Provide an HTML or text body',
  path: ['html'],
});

const sendEmailResponseSchema = z.object({ id: z.string().min(1) });
export type SendEmailInput = z.infer<typeof sendEmailInputSchema>;

export interface ResendBindings {
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
}

export class ResendError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ResendError';
  }
}

const ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 15_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Sends one email through Resend. No SDK or provider secret is needed at startup. */
export async function sendEmail(
  env: ResendBindings,
  input: SendEmailInput,
  options: { idempotencyKey?: string; signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<{ id: string }> {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new ResendError('Resend is not configured');
  const payload = sendEmailInputSchema.parse({ ...input, from: input.from ?? env.RESEND_FROM });
  if (options.idempotencyKey && (options.idempotencyKey.length > 256 || !/^[\x20-\x7E]+$/.test(options.idempotencyKey))) {
    throw new ResendError('Invalid Resend idempotency key');
  }

  const fetcher = options.fetcher ?? fetch;
  const maxAttempts = options.idempotencyKey ? 3 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetcher(ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
        },
        body: JSON.stringify(payload),
      });
    } catch {
      if (options.signal?.aborted) throw new ResendError('Email request was cancelled');
      if (controller.signal.aborted) throw new ResendError('Resend request timed out');
      throw new ResendError('Resend could not be reached');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }

    if (response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ResendError('Resend returned an invalid response', response.status);
      }
      const parsed = sendEmailResponseSchema.safeParse(body);
      if (!parsed.success) throw new ResendError('Resend returned an unexpected response', response.status);
      return parsed.data;
    }

    const retryable = RETRYABLE_STATUSES.has(response.status);
    if (retryable && attempt + 1 < maxAttempts) {
      await waitForRetry(response.headers.get('Retry-After'), options.signal);
      continue;
    }
    throw new ResendError(`Resend request failed (${response.status})`, response.status, retryable);
  }

  throw new ResendError('Resend request failed');
}

async function waitForRetry(retryAfter: string | null, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new ResendError('Email request was cancelled');
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  const date = retryAfter ? Date.parse(retryAfter) : Number.NaN;
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(date) ? date - Date.now() : 500;
  const boundedDelay = Math.max(0, Math.min(delay, 5000));

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, boundedDelay);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ResendError('Email request was cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
