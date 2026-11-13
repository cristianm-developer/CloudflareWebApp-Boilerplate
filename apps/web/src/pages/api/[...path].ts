import { env } from 'cloudflare:workers';
import { api } from '@boilerplate/api/router';
import type { WorkerEnv } from '@boilerplate/api/env';

export const prerender = false;

export const ALL = ({ request, locals }: {
  request: Request;
  locals: App.Locals & { cfContext: ExecutionContext };
}) => {
  return api.fetch(request, env as WorkerEnv, locals.cfContext);
};
