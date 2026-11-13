import { useEffect, useState } from 'preact/hooks';
import { http } from '../lib/http';
import { sendNativeBillingRequest } from '../lib/native-billing';

interface NativePurchaseUpdate {
  version: 1;
  type: 'billing.purchaseUpdate';
  purchaseId: string;
  productId: string;
  status: 'pending' | 'purchased' | 'restored' | 'error' | 'canceled';
  purchaseToken?: string;
  error?: string;
}

interface NativeBridgeEvent extends CustomEvent<NativePurchaseUpdate> {}

export function PlayPurchaseListener() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    const inFlight = new Set<string>();

    const onNativeEvent = async (event: Event) => {
      const purchase = (event as NativeBridgeEvent).detail;
      if (!purchase || purchase.version !== 1 || purchase.type !== 'billing.purchaseUpdate') return;
      if (purchase.status === 'pending') {
        setMessage('Compra pendiente de Google Play…');
        return;
      }
      if (purchase.status !== 'purchased' && purchase.status !== 'restored') {
        if (purchase.status === 'error') setMessage(`Google Play informó un error: ${purchase.error ?? 'unknown'}`);
        return;
      }
      if (!purchase.purchaseToken || !purchase.productId || !purchase.purchaseId || inFlight.has(purchase.purchaseId)) return;

      inFlight.add(purchase.purchaseId);
      setMessage('Verificando la compra con el servidor…');
      try {
        const response = await http.post<{ verified: boolean }>('/api/billing/google-play/verify', {
          productId: purchase.productId,
          purchaseToken: purchase.purchaseToken,
        });
        if (!response.data.verified) throw new Error('La compra aún no fue verificada.');

        const completed = sendNativeBillingRequest({ type: 'billing.complete', purchaseId: purchase.purchaseId });
        setMessage(completed ? 'Compra verificada y completada.' : 'Compra verificada. Cierra y vuelve a abrir la app para sincronizar Google Play.');
      } catch {
        setMessage('No se pudo verificar la compra. No se concedió el acceso; inténtalo de nuevo más tarde.');
      } finally {
        inFlight.delete(purchase.purchaseId);
      }
    };

    window.addEventListener('nativeBridgeEvent', onNativeEvent);
    return () => window.removeEventListener('nativeBridgeEvent', onNativeEvent);
  }, []);

  return (
    <div class="mt-5 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => setMessage(sendNativeBillingRequest({ type: 'billing.restore' })
          ? 'Buscando compras anteriores…'
          : 'La restauración de compras solo está disponible en la app Android.')}
        class="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        Restaurar compras
      </button>
      {message && <p role="status" class="text-sm text-slate-600">{message}</p>}
    </div>
  );
}

export function requestPlayPurchase(productId: string): boolean {
  return sendNativeBillingRequest({ type: 'billing.purchase', productId });
}
