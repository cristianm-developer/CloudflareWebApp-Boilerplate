import { useMutation, useQueryClient } from '@tanstack/preact-query';
import { useState } from 'preact/hooks';
import { http } from '../lib/http';
import { useAvailableTenants } from '../lib/tenants';
import { tenantContextStore, useTenantRef } from '../lib/tenant-context-store';

export function TenantSwitcher() {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const tenants = useAvailableTenants();
  const tenantRef = useTenantRef();
  const queryClient = useQueryClient();
  const createTenant = useMutation({
    mutationFn: async (tenantName: string) => (await http.post<{ tenant: { id: string } }>('/api/tenants/', { name: tenantName })).data,
    onSuccess: async ({ tenant }) => {
      await queryClient.invalidateQueries({ queryKey: ['available-tenants'] });
      tenantContextStore.getState().setTenantRef(tenant.id);
      window.location.reload();
    },
  });

  return (
    <div class="flex flex-wrap items-center gap-2">
      {tenants.data && tenants.data.length > 1 && <label class="flex items-center gap-2 text-sm text-slate-600">
        <span class="sr-only">Tenant activo</span>
        <select
          value={tenantRef}
          onChange={(event) => {
            tenantContextStore.getState().setTenantRef(event.currentTarget.value);
            window.location.reload();
          }}
          class="max-w-56 rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
          aria-label="Tenant activo"
        >
          {tenants.data.map((tenant) => (
            <option key={tenant.id} value={tenant.kind === 'personal' ? 'personal' : tenant.id}>{tenant.name} · {tenant.role}</option>
          ))}
        </select>
      </label>}
      <button type="button" onClick={() => setShowCreate(!showCreate)} class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Crear tenant</button>
      {showCreate && <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) createTenant.mutate(name.trim()); }} class="flex items-center gap-2">
        <input required minLength={2} maxLength={100} value={name} onInput={(event) => setName(event.currentTarget.value)} aria-label="Nombre del tenant" placeholder="Nombre del tenant" class="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button type="submit" disabled={createTenant.isPending} class="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{createTenant.isPending ? 'Creando…' : 'Crear'}</button>
      </form>}
      {createTenant.error && <span role="alert" class="text-xs text-rose-700">No se pudo crear el tenant.</span>}
    </div>
  );
}
