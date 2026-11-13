import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/preact-query';
import { useState } from 'preact/hooks';
import { authClient } from '../lib/auth-client';
import { http } from '../lib/http';
import { tenantContextStore } from '../lib/tenant-context-store';
import { useTenantRef } from '../lib/tenant-context-store';
import { useAvailableTenants } from '../lib/tenants';
import { TenantSwitcher } from './tenant-switcher';
import { HealthCheckView } from './health-check-view';

const queryClient = new QueryClient();

interface TenantSummary {
  tenant: { id: string; name: string; slug: string; kind: string; status: string; member_count: number; active_member_count: number };
}
interface UserList {
  users: Array<{ id: string; name: string; email: string; role: string; membership_status: string; joined_at: string }>;
  actorUserId: string;
  pagination: { limit: number; offset: number; total: number };
}
interface BillingList {
  entitlements: Array<{ provider: string; plan_name: string | null; plan_key: string; status: string; current_period_end: string | null }>;
}

function AdminPanelContent() {
  const [tenantName, setTenantName] = useState('');
  const [activeView, setActiveView] = useState<'overview' | 'health'>('overview');
  const tenantRef = useTenantRef();
  const tenants = useAvailableTenants();
  const queryClient = useQueryClient();
  const updateMembership = useMutation({
    mutationFn: async ({ userId, ...update }: { userId: string; role?: string; status?: string }) =>
      http.patch(`/api/admin/users/${encodeURIComponent(userId)}`, update),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users', tenantRef] }),
  });
  const updateTenant = useMutation({
    mutationFn: async (name: string) => http.patch('/api/admin/tenant', { name }),
    onSuccess: () => {
      setTenantName('');
      return queryClient.invalidateQueries({ queryKey: ['admin-tenant-summary', tenantRef] });
    },
  });
  const openBillingPortal = useMutation({
    mutationFn: async () => (await http.post<{ portalUrl: string }>('/api/billing/stripe/portal')).data,
    onSuccess: ({ portalUrl }) => window.location.assign(portalUrl),
  });
  const tenant = useQuery({
    queryKey: ['admin-tenant-summary', tenantRef],
    queryFn: async () => {
      const token = await http.post<{ accessToken: string }>(`/api/tenants/${encodeURIComponent(tenantRef)}/context-token`);
      tenantContextStore.getState().setAccessToken(token.data.accessToken);
      const response = await http.get<TenantSummary>('/api/admin/tenant');
      return response.data;
    },
    enabled: tenants.isSuccess,
    retry: false,
  });
  const users = useQuery({
    queryKey: ['admin-users', tenantRef],
    queryFn: async () => (await http.get<UserList>('/api/admin/users')).data,
    enabled: tenant.isSuccess && activeView === 'overview',
    retry: false,
  });
  const billing = useQuery({
    queryKey: ['admin-billing', tenantRef],
    queryFn: async () => (await http.get<BillingList>('/api/admin/billing')).data,
    enabled: tenant.isSuccess && activeView === 'overview',
    retry: false,
  });

  async function signOut() {
    await authClient.signOut();
    tenantContextStore.getState().setTenantRef('personal');
    tenantContextStore.getState().setAccessToken(null);
    window.location.assign('/login');
  }

  if (tenants.isPending || tenant.isPending) return <p class="text-slate-500">Cargando administración…</p>;
  if (tenants.error || tenant.error) return <div role="alert" class="flex flex-wrap items-center gap-4 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800"><span>No tienes permiso de administración en el tenant activo, o la sesión expiró.</span><TenantSwitcher /><a href="/app" class="font-semibold underline">Volver a la app</a></div>;

  return (
    <section class="w-full max-w-5xl space-y-6">
      <nav aria-label="Vistas de administración" role="tablist" class="flex w-fit gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        <button type="button" role="tab" aria-controls="admin-overview-panel" aria-selected={activeView === 'overview'} onClick={() => setActiveView('overview')} class={`rounded-lg px-4 py-2 text-sm font-semibold transition ${activeView === 'overview' ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'}`}>Resumen</button>
        <button type="button" role="tab" aria-controls="admin-health-panel" aria-selected={activeView === 'health'} onClick={() => setActiveView('health')} class={`rounded-lg px-4 py-2 text-sm font-semibold transition ${activeView === 'health' ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'}`}>Health Check</button>
      </nav>
      {activeView === 'health' ? <div id="admin-health-panel" role="tabpanel"><HealthCheckView tenantRef={tenantRef} enabled={tenant.isSuccess} /></div> : <div id="admin-overview-panel" role="tabpanel" class="space-y-6">
      <header class="flex items-center justify-between rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <div><p class="text-sm font-semibold text-brand-700">Administración de tenant</p><h1 class="mt-2 text-3xl font-bold">{tenant.data.tenant.name}</h1><p class="mt-1 text-sm text-slate-500">/{tenant.data.tenant.slug} · {tenant.data.tenant.kind}</p><form onSubmit={(event) => { event.preventDefault(); if (tenantName.trim()) updateTenant.mutate(tenantName.trim()); }} class="mt-4 flex flex-wrap gap-2"><input aria-label="Nuevo nombre del tenant" value={tenantName} onInput={(event) => setTenantName(event.currentTarget.value)} placeholder="Cambiar nombre del tenant" class="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button type="submit" disabled={!tenantName.trim() || updateTenant.isPending} class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">Guardar nombre</button></form>{updateTenant.error && <p role="alert" class="mt-2 text-sm text-rose-700">No se pudo cambiar el nombre.</p>}</div>
        <div class="flex items-center gap-3"><TenantSwitcher /><button onClick={signOut} class="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50">Salir</button></div>
      </header>
      <div class="grid gap-4 sm:grid-cols-3">
        <article class="rounded-2xl border border-slate-200 bg-white p-5"><p class="text-sm text-slate-500">Miembros</p><p class="mt-2 text-3xl font-bold">{tenant.data.tenant.member_count}</p></article>
        <article class="rounded-2xl border border-slate-200 bg-white p-5"><p class="text-sm text-slate-500">Activos</p><p class="mt-2 text-3xl font-bold">{tenant.data.tenant.active_member_count}</p></article>
        <article class="rounded-2xl border border-slate-200 bg-white p-5"><p class="text-sm text-slate-500">Estado</p><p class="mt-2 text-3xl font-bold capitalize">{tenant.data.tenant.status}</p></article>
      </div>
      <article class="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div class="border-b border-slate-200 px-6 py-4"><h2 class="font-semibold">Usuarios del tenant</h2><p class="text-sm text-slate-500">{users.data?.pagination.total ?? '…'} usuarios</p></div>
        {users.error ? <p role="alert" class="p-6 text-sm text-rose-700">No se pudo cargar la lista de usuarios.</p> : <div class="overflow-x-auto"><table class="w-full text-left text-sm"><thead class="bg-slate-50 text-slate-500"><tr><th class="px-6 py-3 font-medium">Nombre</th><th class="px-6 py-3 font-medium">Correo</th><th class="px-6 py-3 font-medium">Rol</th><th class="px-6 py-3 font-medium">Estado</th><th class="px-6 py-3 font-medium">Acciones</th></tr></thead><tbody>{(users.data?.users ?? []).map((user) => <tr key={user.id} class="border-t border-slate-100"><td class="px-6 py-3 font-medium">{user.name}</td><td class="px-6 py-3">{user.email}</td><td class="px-6 py-3">{user.role}</td><td class="px-6 py-3">{user.membership_status}</td><td class="px-6 py-3"><div class="flex flex-wrap gap-2">{user.role !== 'owner' && user.id !== users.data?.actorUserId && <><button type="button" disabled={updateMembership.isPending} onClick={() => updateMembership.mutate({ userId: user.id, role: user.role === 'admin' ? 'member' : 'admin' })} class="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">{user.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button><button type="button" disabled={updateMembership.isPending} onClick={() => updateMembership.mutate({ userId: user.id, status: user.membership_status === 'active' ? 'suspended' : 'active' })} class="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">{user.membership_status === 'active' ? 'Suspender' : 'Reactivar'}</button></>}</div></td></tr>)}</tbody></table></div>}
        {updateMembership.error && <p role="alert" class="px-6 pb-5 text-sm text-rose-700">No se pudo actualizar la membresía. Refresca y vuelve a intentar.</p>}
      </article>
      <article class="rounded-2xl border border-slate-200 bg-white p-6">
        <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="font-semibold">Planes y pagos</h2><button type="button" disabled={openBillingPortal.isPending} onClick={() => openBillingPortal.mutate()} class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">{openBillingPortal.isPending ? 'Abriendo…' : 'Gestionar suscripción web'}</button></div>
        {openBillingPortal.error && <p class="mt-2 text-sm text-slate-500">No hay un cliente de Stripe asociado a este tenant.</p>}
        {billing.isPending ? <p class="mt-2 text-sm text-slate-500">Cargando…</p> : billing.data ? <ul class="mt-3 space-y-2">{billing.data.entitlements.length ? billing.data.entitlements.map((entry) => <li key={`${entry.provider}:${entry.plan_key}`} class="flex flex-wrap justify-between gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm"><span>{entry.plan_name ?? entry.plan_key} · {entry.provider}</span><span class="text-slate-500">{entry.status}{entry.current_period_end ? ` · hasta ${entry.current_period_end}` : ''}</span></li>) : <li class="text-sm text-slate-500">Sin entitlements registrados.</li>}</ul> : <p class="mt-2 text-sm text-slate-500">{billing.error ? 'El módulo de billing todavía no está configurado.' : ''}</p>}
      </article>
      </div>}
    </section>
  );
}

export function AdminPanel() {
  return <QueryClientProvider client={queryClient}><AdminPanelContent /></QueryClientProvider>;
}
