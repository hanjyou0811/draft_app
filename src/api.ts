import type { Credentials, RoomStatus, RoomView } from '../shared/types.js';

export interface RoomInfo {
  readonly status: RoomStatus;
  readonly teamSize: number;
  readonly participantCount: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNetworkFailure(): boolean {
    return this.status === undefined;
  }
}

const credentialKey = (roomId: string) => `draft-room:credentials:${roomId}`;
export interface CredentialState {
  readonly credentials: Credentials;
  readonly persisted: boolean;
}

const memoryCredentials = new Map<string, CredentialState>();
const storageProbeKey = 'draft-room:storage-probe';

export function canPersistCredentials(): boolean {
  try {
    localStorage.setItem(storageProbeKey, '1');
    localStorage.removeItem(storageProbeKey);
    return true;
  } catch {
    return false;
  }
}

export function readCredentialState(roomId: string): CredentialState | undefined {
  const retained = memoryCredentials.get(roomId);
  if (retained !== undefined) return retained;
  try {
    const raw = localStorage.getItem(credentialKey(roomId));
    if (raw === null) return undefined;
    const value = JSON.parse(raw) as Partial<Credentials>;
    if (value.roomId !== roomId || typeof value.token !== 'string' || value.token.length === 0) {
      return undefined;
    }
    const restored = { credentials: { roomId, token: value.token }, persisted: true } as const;
    memoryCredentials.set(roomId, restored);
    return restored;
  } catch {
    return undefined;
  }
}

export function readCredentials(roomId: string): Credentials | undefined {
  return readCredentialState(roomId)?.credentials;
}

export function saveCredentials(credentials: Credentials): boolean {
  memoryCredentials.set(credentials.roomId, { credentials, persisted: false });
  try {
    localStorage.setItem(credentialKey(credentials.roomId), JSON.stringify(credentials));
    memoryCredentials.set(credentials.roomId, { credentials, persisted: true });
    return true;
  } catch {
    return false;
  }
}

export function clearCredentials(roomId: string): void {
  memoryCredentials.delete(roomId);
  try {
    localStorage.removeItem(credentialKey(roomId));
  } catch {
    // Authentication recovery must continue when storage is unavailable.
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      signal: AbortSignal.timeout(10_000),
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError('サーバーと通信できませんでした。');
  }
  const body = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : 'リクエストを完了できませんでした。';
    throw new ApiError(message, response.status);
  }
  return body as T;
}

const authorization = (token: string): HeadersInit => ({ authorization: `Bearer ${token}` });

export const api = {
  createRoom: (body: { name: string; names: string; teamSize: number }) =>
    request<Credentials>('/api/rooms', { method: 'POST', body: JSON.stringify(body) }),
  getInfo: (roomId: string) => request<RoomInfo>(`/api/rooms/${encodeURIComponent(roomId)}/info`),
  joinRoom: (roomId: string, name: string) => request<Credentials>(
    `/api/rooms/${encodeURIComponent(roomId)}/join`,
    { method: 'POST', body: JSON.stringify({ name }) },
  ),
  getRoom: ({ roomId, token }: Credentials) => request<RoomView>(
    `/api/rooms/${encodeURIComponent(roomId)}`,
    { headers: authorization(token) },
  ),
  startRoom: ({ roomId, token }: Credentials) => request<RoomView>(
    `/api/rooms/${encodeURIComponent(roomId)}/start`,
    { method: 'POST', headers: authorization(token) },
  ),
  submitPick: (
    { roomId, token }: Credentials,
    body: { candidateId: string; round: number; attempt: number },
  ) => request<RoomView>(`/api/rooms/${encodeURIComponent(roomId)}/picks`, {
    method: 'POST',
    headers: authorization(token),
    body: JSON.stringify(body),
  }),
};

export function roomWebSocketUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}
