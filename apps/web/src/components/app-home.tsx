import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/preact-query';
import { authClient } from '../lib/auth-client';
import { http } from '../lib/http';
import { tenantContextStore } from '../lib/tenant-context-store';
import { PlayPurchaseListener } from './play-purchase-listener';
import { BillingPlans } from './billing-plans';
import { useTenantRef } from '../lib/tenant-context-store';
import { useAvailableTenants } from '../lib/tenants';
import { TenantSwitcher } from './tenant-switcher';

const queryClient = new QueryClient();

interface TenantContextResponse {
  tenant: { id: string; key: string; role: string };
  permissions: string[];
}

function AppHomeContent() {
  const tenantRef = useTenantRef();
  const tenants = useAvailableTenants();
  const context = useQuery<TenantContextResponse>({
    queryKey: ['active-tenant-context', tenantRef],
    queryFn: async () => {
      const tokenResponse = await http.post<{ accessToken: string }>(`/api/tenants/${encodeURIComponent(tenantRef)}/context-token`);
      tenantContextStore.getState().setAccessToken(tokenResponse.data.accessToken);
      const response = await http.get<TenantContextResponse>('/api/tenant/context');
      return response.data;
    },
    enabled: tenants.isSuccess,
    retry: false,
  });

  async function signOut() {
    await authClient.signOut();
    tenantContextStore.getState().setTenantRef('personal');
    tenantContextStore.getState().setAccessToken(null);
    window.location.assign('/login');
  }

  if (tenants.isPending || context.isPending) return <p class="text-slate-500">Cargando tenant seguro…</p>;
  if (tenants.error || context.error) return (
    <div class="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
      <p>No pudimos cargar tu tenant. Inicia sesión y vuelve a intentarlo.</p>
      <a class="mt-3 inline-block font-semibold underline" href="/login">Volver al login</a>
    </div>
  );

  return (
    <section class="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5">
      <div class="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p class="text-sm font-semibold text-brand-700">Tenant activo</p>
          <h1 class="mt-2 text-3xl font-bold tracking-tight">{context.data.tenant.key}</h1>
          <p class="mt-2 text-slate-600">Rol: <span class="font-semibold">{context.data.tenant.role}</span></p>
        </div>
        <div class="flex items-center gap-3"><TenantSwitcher />{context.data.permissions.includes('admin.manage') && <a href="/admin" class="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50">Administrar</a>}<button onClick={signOut} class="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50">Salir</button></div>
      </div>
      <div class="mt-8 rounded-2xl bg-slate-50 p-5">
        <h2 class="font-semibold">Permisos verificados por el backend</h2>
        <ul class="mt-3 flex flex-wrap gap-2">
          {context.data.permissions.map((permission) => <li class="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">{permission}</li>)}
        </ul>
      </div>
      <p class="mt-6 text-xs leading-5 text-slate-500">Esta pantalla obtiene un JWT de tenant de corta duración y lo revalida junto con la sesión Better Auth en cada llamada protegida.</p>
      <PlayPurchaseListener />
      <BillingPlans canManageBilling={context.data.permissions.includes('billing.manage')} />
    </section>
  );
}

export function AppHome() {
  return <QueryClientProvider client={queryClient}><AppHomeContent /></QueryClientProvider>;
}
