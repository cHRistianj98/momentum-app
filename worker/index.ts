/**
 * Momentum — Cloudflare Worker: statyczna aplikacja (Workers Static Assets) + API.
 *
 * Konfiguracja w wrangler.jsonc: żądania /api/* trafiają najpierw tutaj (run_worker_first),
 * a wszystko inne serwuje bezpośrednio warstwa statycznych plików — bez uruchamiania Workera
 * (darmowo i bez limitu). Gdyby inne żądanie jednak tu trafiło, oddajemy je do ASSETS.
 * Cron (co minutę) wysyła przypomnienia push, także gdy aplikacja jest zamknięta.
 */
import { handlePushRequest, runPushQueue } from './push';
import { handleSyncRequest, type SyncEnv } from './sync';

interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env extends SyncEnv {
  ASSETS: AssetsBinding;
}

interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/push/')) return handlePushRequest(request, env, ctx);
    if (pathname === '/api' || pathname.startsWith('/api/')) return handleSyncRequest(request, env, ctx);
    return env.ASSETS.fetch(request);
  },

  scheduled(_controller: unknown, env: Env, ctx: WorkerContext): void {
    ctx.waitUntil(runPushQueue(env)
      .then(result => { if (result.sent || result.failed || result.removedDevices) console.log('[momentum-push]', JSON.stringify(result)); })
      .catch(error => console.error('[momentum-push] cron failed', error)));
  },
};
