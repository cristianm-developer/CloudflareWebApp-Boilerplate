import { z } from 'zod';

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1),
});

export const chatCompletionInputSchema = z.object({
  model: z.string().min(1).max(200),
  messages: z.array(messageSchema).min(1).max(128),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().max(200_000).optional(),
  top_p: z.number().gt(0).lte(1).optional(),
});

const chatCompletionResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  choices: z.array(z.object({
    finish_reason: z.string().nullable().optional(),
    message: z.object({
      role: z.string().optional(),
      content: z.string().nullable().optional(),
    }),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
  }).optional(),
});

export type ChatCompletionInput = z.infer<typeof chatCompletionInputSchema>;
export type ChatCompletionResponse = z.infer<typeof chatCompletionResponseSchema>;

export interface OpenRouterBindings {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_SITE_URL?: string;
  OPENROUTER_SITE_NAME?: string;
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 45_000;

export async function createChatCompletion(
  env: OpenRouterBindings,
  input: ChatCompletionInput,
  options: { signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<ChatCompletionResponse> {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new OpenRouterError('OpenRouter is not configured');
  const payload = chatCompletionInputSchema.parse(input);
  const fetcher = options.fetcher ?? fetch;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { signal, dispose } = timeoutSignal(options.signal, TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetcher(ENDPOINT, {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(env.OPENROUTER_SITE_URL ? { 'HTTP-Referer': env.OPENROUTER_SITE_URL } : {}),
          ...(env.OPENROUTER_SITE_NAME ? { 'X-Title': env.OPENROUTER_SITE_NAME } : {}),
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (options.signal?.aborted) throw new OpenRouterError('OpenRouter request was cancelled');
      if (signal.aborted) throw new OpenRouterError('OpenRouter request timed out');
      throw new OpenRouterError('OpenRouter could not be reached');
    } finally {
      dispose();
    }

    if (response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new OpenRouterError('OpenRouter returned an invalid response', response.status);
      }
      const parsed = chatCompletionResponseSchema.safeParse(body);
      if (!parsed.success) throw new OpenRouterError('OpenRouter returned an unexpected response', response.status);
      return parsed.data;
    }

    if (response.status === 429 && attempt === 0) {
      await waitForRetry(response.headers.get('Retry-After'), options.signal);
      continue;
    }
    throw new OpenRouterError(
      response.status === 429 ? 'OpenRouter rate limit reached' : `OpenRouter request failed (${response.status})`,
      response.status,
      response.status === 429,
    );
  }

  throw new OpenRouterError('OpenRouter rate limit reached', 429, true);
}

function timeoutSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

async function waitForRetry(retryAfter: string | null, signal?: AbortSignal): Promise<void> {
  const parsedSeconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  const parsedDate = retryAfter ? Date.parse(retryAfter) : Number.NaN;
  const delayMs = Number.isFinite(parsedSeconds)
    ? parsedSeconds * 1000
    : Number.isFinite(parsedDate)
      ? parsedDate - Date.now()
      : 1000;
  const boundedDelay = Math.max(0, Math.min(delayMs, 5000));

  if (signal?.aborted) throw new OpenRouterError('OpenRouter request was cancelled');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, boundedDelay);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new OpenRouterError('OpenRouter request was cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
