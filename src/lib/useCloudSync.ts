import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { CLOUD_SYNC_OFF_STATE, getCloudSyncEngine, type CloudSyncEngine, type CloudSyncState } from './cloudSync';

export interface CloudSyncApi {
  /** Feature flag „cloudSync” jest włączony na tym urządzeniu. */
  available: boolean;
  state: CloudSyncState;
  engine: CloudSyncEngine | null;
}

const subscribeNothing = () => () => undefined;
const offState = () => CLOUD_SYNC_OFF_STATE;

/** Przy wyłączonej fladze nie tworzy silnika, nie dodaje nasłuchów i nie wykonuje żadnych żądań. */
export function useCloudSync(available: boolean): CloudSyncApi {
  const engine = available ? getCloudSyncEngine() : null;
  const state = useSyncExternalStore(engine ? engine.subscribe : subscribeNothing, engine ? engine.getState : offState);
  const enabled = state.enabled;
  useEffect(() => {
    if (!engine || !enabled) return undefined;
    engine.start();
    return () => engine.stop();
  }, [engine, enabled]);
  return useMemo(() => ({ available, state, engine }), [available, state, engine]);
}
