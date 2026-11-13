import type { ConfigurationCheck, ConfigurationStatus } from '../lib/admin-health';
import { useAdminHealthCheck } from '../lib/admin-health';

const statusLabels: Record<ConfigurationStatus, string> = {
  ready: 'Configurado',
  incomplete: 'Incompleto',
  error: 'Error de configuración',
  disabled: 'Deshabilitado',
};

const statusStyles: Record<ConfigurationStatus, string> = {
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  incomplete: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-rose-200 bg-rose-50 text-rose-800',
  disabled: 'border-slate-200 bg-slate-100 text-slate-600',
};

function StatusBadge({ status }: { status: ConfigurationStatus }) {
  return <span class={`inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusStyles[status]}`}>{statusLabels[status]}</span>;
}

function HealthRow({ item }: { item: ConfigurationCheck }) {
  return (
    <li class="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
      <div class="min-w-0">
        <h3 class="font-semibold text-slate-900">{item.name}</h3>
        <p class="mt-1 text-sm leading-6 text-slate-600">{item.summary}</p>
        {item.notes.length > 0 && (
          <ul class="mt-2 space-y-1 text-xs leading-5 text-slate-500">
            {item.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        )}
      </div>
      <StatusBadge status={item.status} />
    </li>
  );
}

export function HealthCheckView({ tenantRef, enabled }: { tenantRef: string; enabled: boolean }) {
  const health = useAdminHealthCheck(tenantRef, enabled);

  return (
    <section class="space-y-5" aria-labelledby="health-check-title">
      <header class="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
        <div>
          <p class="text-sm font-semibold text-brand-700">Diagnóstico del entorno</p>
          <h2 id="health-check-title" class="mt-1 text-2xl font-bold tracking-tight text-slate-950">Health Check</h2>
          <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Revisa si los módulos tienen su configuración presente. No llama a proveedores ni inspecciona datos o secretos.
          </p>
        </div>
        <button
          type="button"
          disabled={health.isFetching}
          onClick={() => void health.refetch()}
          class="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50"
        >
          {health.isFetching ? 'Actualizando…' : 'Actualizar'}
        </button>
      </header>

      {health.isPending ? (
        <div class="space-y-3" aria-label="Cargando diagnóstico">
          {[0, 1, 2].map((item) => <div key={item} class="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
        </div>
      ) : health.error ? (
        <div role="alert" class="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
          No se pudo cargar el diagnóstico. Verifica que tengas permiso de administración y vuelve a intentarlo.
        </div>
      ) : health.data ? (
        <>
          <div class="grid gap-3 sm:grid-cols-4">
            {(['ready', 'incomplete', 'error', 'disabled'] as const).map((status) => {
              const count = health.data.checks.filter((item) => item.status === status).length;
              return (
                <article key={status} class="rounded-2xl border border-slate-200 bg-white p-4">
                  <p class="text-xs font-medium text-slate-500">{statusLabels[status]}</p>
                  <p class="mt-1 text-2xl font-bold text-slate-900">{count}</p>
                </article>
              );
            })}
          </div>

          <article class="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <header class="flex flex-wrap items-center justify-between gap-2 px-5 py-4 sm:px-6">
              <div>
                <h3 class="font-semibold text-slate-950">Configuración de módulos</h3>
                <p class="mt-1 text-xs text-slate-500">Entorno: {health.data.environment}</p>
              </div>
              <p class="text-xs text-slate-500">
                Revisado {new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(health.data.checkedAt))}
              </p>
            </header>
            <ul>
              {health.data.checks.map((item) => <HealthRow key={item.id} item={item} />)}
            </ul>
          </article>
          <p class="text-xs leading-5 text-slate-500">
            “Configurado” confirma presencia y formato básico de variables/bindings. No garantiza disponibilidad externa ni que las migraciones estén aplicadas.
          </p>
        </>
      ) : null}
    </section>
  );
}
