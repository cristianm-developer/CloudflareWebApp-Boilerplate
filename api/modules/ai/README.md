# OpenRouter adapter

`createChatCompletion(env, input, options?)` is a backend-only adapter for OpenRouter's OpenAI-compatible Chat Completions endpoint. It validates input/output with Zod, applies a bounded 45 second timeout, optionally sends `HTTP-Referer` and `X-Title`, and retries one explicit HTTP 429 while respecting a bounded `Retry-After`. Network failures, timeouts, and other statuses are not retried, avoiding ambiguous repeated inference charges. Errors omit prompts, response bodies, and secrets.

Set `OPENROUTER_API_KEY` as a Worker secret. `OPENROUTER_SITE_URL` and `OPENROUTER_SITE_NAME` are optional metadata. The API key is only read when calling the adapter, so the app builds without it. Check the [OpenRouter chat completion API](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion) for current request fields and supported model features.
