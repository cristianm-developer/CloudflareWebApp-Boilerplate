import { useQuery } from '@tanstack/preact-query';
import { http } from './http';

export interface AvailableTenant {
  id: string;
  name: string;
  slug: string;
  kind: 'personal' | 'organization';
  role: string;
}

interface AvailableTenantsResponse {
  tenants: AvailableTenant[];
}

export function useAvailableTenants() {
  return useQuery({
    queryKey: ['available-tenants'],
    queryFn: async () => (await http.get<AvailableTenantsResponse>('/api/tenants/')).data.tenants,
    retry: false,
    staleTime: 30_000,
  });
}
