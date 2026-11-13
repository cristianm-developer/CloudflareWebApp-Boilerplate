import { useSyncExternalStore } from 'preact/compat';
import { createStore } from 'zustand/vanilla';

interface TenantContextState {
  tenantRef: string;
  accessToken: string | null;
  setTenantRef: (tenantRef: string) => void;
  setAccessToken: (accessToken: string | null) => void;
}

export const tenantContextStore = createStore<TenantContextState>((set) => ({
  tenantRef: typeof window === 'undefined' ? 'personal' : window.localStorage.getItem('activeTenantRef') || 'personal',
  accessToken: null,
  setTenantRef: (tenantRef) => {
    if (typeof window !== 'undefined') window.localStorage.setItem('activeTenantRef', tenantRef);
    set({ tenantRef, accessToken: null });
  },
  setAccessToken: (accessToken) => set({ accessToken }),
}));

export function useTenantRef(): string {
  return useSyncExternalStore(
    tenantContextStore.subscribe,
    () => tenantContextStore.getState().tenantRef,
  );
}

export function useTenantAccessToken(): string | null {
  return useSyncExternalStore(
    tenantContextStore.subscribe,
    () => tenantContextStore.getState().accessToken,
  );
}
