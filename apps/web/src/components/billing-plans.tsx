import { useState } from 'preact/hooks';
import { useQuery } from '@tanstack/preact-query';
import { http } from '../lib/http';
import { requestPlayPurchase } from './play-purchase-listener';

interface BillingCatalog {
  plans: Array<{
    provider: 'stripe' | 'google-play';
    product_id: string;
    plan_key: string;
    display_name: string;
    rank: number;
  }>;
}

export function BillingPlans({ canManageBilling }: { canManageBilling: boolean }) {
  const [message, setMessage] = useState('');
  const [pendingProduct, setPendingProduct] = useState('');
  const plans = useQuery({
    queryKey: ['billing-catalog'],
    queryFn: async () => (await http.get<BillingCatalog>('/api/billing/plans')).data,
    retry: false,
  });

  async function checkout(productId: string) {
    setPendingProduct(productId);
    setMessage('');
    try {
      const result = await http.post<{ checkoutUrl: string }>('/api/billing/stripe/checkout', { productId });
      window.location.assign(result.data.checkoutUrl);
    } catch {
      setMessage('No pudimos iniciar el checkout de Stripe. Revisa la configuración de pagos e inténtalo de nuevo.');
      setPendingProduct('');
    }
  }

  function playPurchase(productId: string) {
    const started = requestPlayPurchase(productId);
    setMessage(started
      ? 'Google Play abrió el flujo de compra. Verificaremos la compra en el servidor antes de activar el plan.'
      : 'Google Play Billing solo está disponible en la app Flutter para Android.');
  }

  return (
    <article class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
      <h2 class="font-semibold">Planes disponibles</h2>
      {plans.isPending && <p class="mt-2 text-sm text-slate-500">Cargando planes…</p>}
      {plans.error && <p class="mt-2 text-sm text-slate-500">No hay catálogo de planes configurado todavía.</p>}
      {plans.data && (plans.data.plans.length ? (
        <ul class="mt-4 space-y-3">
          {plans.data.plans.map((plan) => (
            <li key={`${plan.provider}:${plan.product_id}`} class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4">
              <div><p class="font-medium">{plan.display_name}</p><p class="text-xs text-slate-500">{plan.provider === 'stripe' ? 'Web · Stripe' : 'Android · Google Play'}</p></div>
              {plan.provider === 'stripe' ? (
                <button type="button" disabled={!canManageBilling || pendingProduct === plan.product_id} onClick={() => void checkout(plan.product_id)} class="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50">
                  {pendingProduct === plan.product_id ? 'Abriendo…' : 'Suscribirme'}
                </button>
              ) : (
                <button type="button" disabled={!canManageBilling} onClick={() => playPurchase(plan.product_id)} class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50">
                  Comprar en Google Play
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : <p class="mt-2 text-sm text-slate-500">No hay planes publicados.</p>)}
      {!canManageBilling && <p class="mt-3 text-xs text-slate-500">Tu rol no tiene permiso para gestionar la suscripción de este tenant.</p>}
      {message && <p role="status" class="mt-3 text-sm text-slate-600">{message}</p>}
    </article>
  );
}
