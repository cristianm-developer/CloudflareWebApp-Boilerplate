/** Create the personal workspace on first use; this is data provisioning only.
 * D1 schema changes belong in explicit Wrangler migrations, never request code.
 */
export async function ensurePersonalTenant(
  db: D1Database,
  user: { id: string; name?: string | null },
): Promise<string> {
  const safeId = user.id.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 48);
  if (!safeId) throw new Error('Cannot create a personal tenant without a stable user ID.');
  const tenantId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const slug = `personal-${safeId}`;
  const name = user.name?.trim() ? `${user.name.trim()}'s workspace` : 'Personal workspace';

  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO tenants (id, name, slug, kind, status)
       VALUES (?, ?, ?, 'personal', 'active')`,
    ).bind(tenantId, name, slug),
    db.prepare(
      `INSERT OR IGNORE INTO tenant_memberships (id, tenant_id, user_id, role, status, permission_version)
       SELECT ?, id, ?, 'owner', 'active', 1 FROM tenants WHERE slug = ?`,
    ).bind(membershipId, user.id, slug),
  ]);
  const tenant = await db.prepare('SELECT id FROM tenants WHERE slug = ? LIMIT 1').bind(slug).first<{ id: string }>();
  if (!tenant) throw new Error('Failed to ensure a personal tenant.');
  return tenant.id;
}
