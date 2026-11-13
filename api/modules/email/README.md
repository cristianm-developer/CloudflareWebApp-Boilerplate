# Resend adapter

`sendEmail(env, input, options?)` posts validated mail to Resend's REST API with a bounded timeout. It retries explicit transient responses only when the caller supplies an idempotency key; Resend documents keys as expiring after 24 hours, so use a stable per-message key. Network failures and timeouts are not retried. Provider bodies, recipient content, and secrets are never copied into thrown errors.

Set `RESEND_API_KEY` as a Worker secret and `RESEND_FROM` as an environment-specific sender. A per-message `from` value overrides the configured sender. Both values are optional at startup; calling the adapter without a key fails closed. See the [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email).
