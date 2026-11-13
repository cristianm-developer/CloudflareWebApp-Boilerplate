export interface NativeBillingRequest {
  version: 1;
  nonce: string;
  id: string;
  type: 'billing.purchase' | 'billing.restore' | 'billing.complete';
  productId?: string;
  purchaseId?: string;
}

declare global {
  interface Window {
    NativeBridge?: { postMessage(message: string): void };
    __NATIVE_BRIDGE_NONCE?: string;
  }
}

export function sendNativeBillingRequest(
  request: Omit<NativeBillingRequest, 'version' | 'nonce' | 'id'>,
): boolean {
  const bridge = window.NativeBridge;
  const nonce = window.__NATIVE_BRIDGE_NONCE;
  if (!bridge || !nonce) return false;

  bridge.postMessage(JSON.stringify({
    ...request,
    version: 1,
    nonce,
    id: crypto.randomUUID(),
  } satisfies NativeBillingRequest));
  return true;
}
