import { useQuery } from '@tanstack/preact-query';
import { http } from './http';

export type ConfigurationStatus = 'ready' | 'incomplete' | 'error' | 'disabled';

export interface ConfigurationCheck {
  id: string;
  name: string;
  status: ConfigurationStatus;
  summary: string;
  notes: string[];
}

export interface ConfigurationHealthReport {
  environment: string;
  checkedAt: string;
  checks: ConfigurationCheck[];
}

export function useAdminHealthCheck(tenantRef: string, enabled: boolean) {
  return useQuery({
    queryKey: ['admin-health', tenantRef],
    queryFn: async () => (await http.get<ConfigurationHealthReport>('/api/admin/health')).data,
    enabled,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}
