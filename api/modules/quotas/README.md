# Product quotas

This module provides D1-backed, tenant-scoped metering for product features. It is separate from Cloudflare Rate Limiting: request rate limits protect endpoints; quotas meter billable/product usage such as AI tokens, exports, or storage.

Apply `migrations/0003_quotas.sql` to each environment. Configure one effective policy per tenant and quota key in `tenant_quota_policies`; the billing/plan/admin module should resolve plan defaults and add-ons before writing that policy. `limit_value = NULL` means unlimited, and a missing policy fails closed.

Call `consumeQuota(db, activeTenantContext, quotaKey, amount)` only after tenant authorization middleware has populated the context. Its D1 upsert is atomic, so concurrent requests cannot reserve past a finite limit. It returns the period, used/remaining amount, and `resetsAt` for the caller to send as quota metadata or a `429` response.

Windows use UTC calendar boundaries: daily resets at midnight, weekly at Monday midnight, monthly on the first. The next window starts automatically on the next request; no cron or reset job is required. Projects can replace the policy source or window strategy without changing feature handlers.

This is a foundation only: no product-specific policies, payment plan mapping, usage APIs, or retention/aggregation job are enabled by default. Add a trusted policy writer in the billing/admin module; never accept `tenant_id` or limits directly from an untrusted browser request.
