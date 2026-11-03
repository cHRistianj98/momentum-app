import { useEffect, useSyncExternalStore } from 'react';
import { getCloudSyncEngine, type CloudSyncEngine, type CloudSyncState } from './cloudSync';

export interface CloudSyncApi {
  state: CloudSyncState;
  engine: CloudSyncEngine;
}

/** Stan synchronizacji dla UI. Nasłuchy i odpytywanie serwera działają tylko po włączeniu synchronizacji na urządzeniu. */
export function useCloudSync(): CloudSyncApi {
  const engine = getCloudSyncEngine();
  const state = useSyncExternalStore(engine.subscribe, engine.getState);
  const enabled = state.enabled;
  useEffect(() => {
    if (!enabled) return undefined;
    engine.start();
    return () => engine.stop();
  }, [engine, enabled]);
  return { state, engine };
}
