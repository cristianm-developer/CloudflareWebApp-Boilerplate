/// <reference types="astro/client" />
import type { WorkerEnv } from '@boilerplate/api/env';

declare global {
  interface Env extends WorkerEnv {}
}

export {};
