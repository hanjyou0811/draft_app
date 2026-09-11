import { useCallback, useEffect, useRef, useState } from 'react';

import type { Credentials, RoomView } from '../shared/types.js';
import { api, ApiError, clearCredentials } from './api.js';

export type SyncStatus = 'connecting' | 'synced' | 'reconnecting';

interface RoomController {
  readonly room?: RoomView;
  readonly syncStatus: SyncStatus;
  readonly busy: boolean;
  readonly message?: string;
  readonly terminalError?: string;
  readonly authenticationLost: boolean;
  start(): Promise<void>;
  pick(candidateId: string): Promise<void>;
  clearMessage(): void;
}

function newer(current: RoomView | undefined, incoming: RoomView): RoomView {
  return current === undefined || incoming.version >= current.version ? incoming : current;
}

export function useRoom(credentials: Credentials): RoomController {
  const [room, setRoom] = useState<RoomView>();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('connecting');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [terminalError, setTerminalError] = useState<string>();
  const [authenticationLost, setAuthenticationLost] = useState(false);
  const roomRef = useRef<RoomView | undefined>(undefined);
  const reconnectRef = useRef<() => void>(() => undefined);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const applyRoom = useCallback((incoming: RoomView) => {
    setRoom((current) => {
      const next = newer(current, incoming);
      roomRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    let active = true;
    let stopped = false;
    let generation = 0;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = async () => {
      if (!active || stopped) return;
      const cycle = ++generation;
      if (timer !== undefined) clearTimeout(timer);
      try {
        const fetched = await api.getRoom(credentials);
        if (!active || stopped || cycle !== generation) return;
        applyRoom(fetched);
        setSyncStatus('synced');
        retry = 0;
        if (fetched.status === 'completed') return;
      } catch (error) {
        if (!active || stopped || cycle !== generation) return;
        setSyncStatus('reconnecting');
        if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
          stopped = true;
          clearCredentials(credentials.roomId);
          if (error.status === 401) setAuthenticationLost(true);
          else setTerminalError(error.message);
          return;
        }
        retry += 1;
      }
      timer = setTimeout(() => { void connect(); }, Math.min(1_000 * 2 ** retry, 5_000));
    };
    reconnectRef.current = () => {
      setSyncStatus('reconnecting');
      void connect();
    };
    const offline = () => {
      generation += 1;
      if (timer !== undefined) clearTimeout(timer);
      setSyncStatus('reconnecting');
    };
    const online = () => reconnectRef.current();
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    void connect();
    return () => {
      active = false;
      generation += 1;
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, [applyRoom, credentials]);

  const recoverAfterError = useCallback(async (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      clearCredentials(credentials.roomId);
      setAuthenticationLost(true);
      setMessage('この端末の参加情報を確認できませんでした。');
      return;
    }
    setMessage(error instanceof ApiError && !error.isNetworkFailure
      ? error.message
      : '通信結果を確認しています。操作が受け付けられた可能性があります。');
    setSyncStatus('reconnecting');
    try {
      const latest = await api.getRoom(credentials);
      if (mountedRef.current) applyRoom(latest);
    } catch {
      // The reconnect pass below repeats the full snapshot fetch.
    }
    if (mountedRef.current) reconnectRef.current();
  }, [applyRoom, credentials]);

  const command = useCallback(async (action: () => Promise<RoomView>) => {
    if (syncStatus !== 'synced' || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const latest = await action();
      if (mountedRef.current) applyRoom(latest);
    } catch (error) {
      if (mountedRef.current) await recoverAfterError(error);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [applyRoom, busy, recoverAfterError, syncStatus]);

  return {
    ...(room === undefined ? {} : { room }),
    syncStatus,
    busy,
    ...(message === undefined ? {} : { message }),
    ...(terminalError === undefined ? {} : { terminalError }),
    authenticationLost,
    start: () => command(() => api.startRoom(credentials)),
    pick: (candidateId) => {
      const current = roomRef.current;
      return current === undefined
        ? Promise.resolve()
        : command(() => api.submitPick(credentials, {
          candidateId,
          round: current.round,
          attempt: current.attempt,
        }));
    },
    clearMessage: () => setMessage(undefined),
  };
}
