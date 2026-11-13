import { handle } from '@astrojs/cloudflare/handler';
import { purgeExpiredQuotaUsage } from '../../../api/modules/quotas';
import type { WorkerEnv } from '../../../api/env';

export default {
  fetch(request, env, context) {
    return handle(request, env, context);
  },

  async scheduled(_controller, env) {
    const result = await purgeExpiredQuotaUsage(env.DB);
    console.info('Quota usage retention cleanup completed', result);
  },
} satisfies ExportedHandler<WorkerEnv>;
