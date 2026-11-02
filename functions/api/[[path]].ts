/**
 * Cloudflare Pages Function: wszystkie żądania /api/* (synchronizacja Momentum).
 * Logika jest w ../_lib/sync.ts; trasy statyczne nie uruchamiają Functions (public/_routes.json).
 */
import { handleSyncRequest, type SyncContext, type SyncEnv } from '../_lib/sync';

interface PagesContext extends SyncContext {
  request: Request;
  env: SyncEnv;
}

export const onRequest = (context: PagesContext): Promise<Response> =>
  handleSyncRequest(context.request, context.env, { waitUntil: promise => context.waitUntil?.(promise) });
