import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { DispatchSnapshot, LiveEvent } from '@shared/types';
import { applyEvents, emptyState, fromSnapshot, type LiveState } from './liveState';

export type ConnState = 'connecting' | 'live' | 'offline';

/**
 * Subscribes to the realtime `batch` stream and keeps a LiveState.
 * On every (re)connect the snapshot is reloaded, so missed events are healed.
 */
export function useLive(token: string | null, loadSnapshot: () => Promise<Partial<DispatchSnapshot>>) {
  const [state, setState] = useState<LiveState>(emptyState);
  const [conn, setConn] = useState<ConnState>('connecting');
  const loader = useRef(loadSnapshot);
  loader.current = loadSnapshot;

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const socket: Socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
    const sync = () =>
      loader
        .current()
        .then((s) => alive && setState((prev) => fromSnapshot(s, prev)))
        .catch(() => undefined);

    socket.on('connect', () => {
      setConn('live');
      sync();
    });
    socket.on('disconnect', () => setConn('offline'));
    socket.io.on('reconnect_attempt', () => setConn('connecting'));
    socket.on('batch', (events: LiveEvent[]) => setState((s) => applyEvents(s, events)));
    sync();
    return () => {
      alive = false;
      socket.close();
    };
  }, [token]);

  return { state, setState, conn };
}
