import { z } from 'zod';

export { z };

export const providerNames = ['stripe', 'google-play', 'openrouter', 'resend'] as const;
export type ProviderName = (typeof providerNames)[number];

export const permissionNames = [
  'tenant.read',
  'tenant.manage',
  'members.read',
  'members.invite',
  'members.manage',
  'billing.read',
  'billing.manage',
  'admin.manage',
] as const;
export type PermissionName = (typeof permissionNames)[number];

export const quotaPeriodSchema = z.enum(['daily', 'weekly', 'monthly']);
export type QuotaPeriod = z.infer<typeof quotaPeriodSchema>;

export const quotaKeySchema = z.string().regex(/^[a-z][a-z0-9._-]{0,95}$/);
export const quotaPolicySchema = z.object({
  quotaKey: quotaKeySchema,
  period: quotaPeriodSchema,
  limit: z.number().int().nonnegative().nullable(),
});
