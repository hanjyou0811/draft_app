import type { Credentials, RoomStatus, RoomView, SavedTopic, InvitationLink } from '../shared/types.js';

export interface RoomInfo {
  readonly topic?: string;
  readonly status: RoomStatus;
  readonly teamSize: number;
  readonly participantCount: number;
}

export interface InvitationInfo extends RoomInfo {
  readonly roomId: string;
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

const topicOwnerKey = 'draft-room:topic-owner';
const topicOwnerPattern = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}){2}$/iu;

function topicOwnerHeaders(required = false): Record<string, string> {
  try {
    const stored = localStorage.getItem(topicOwnerKey);
    if (stored && topicOwnerPattern.test(stored)) return { 'x-topic-owner': stored };
    if (!required) return {};
    const token = crypto.randomUUID() + crypto.randomUUID();
    localStorage.setItem(topicOwnerKey, token);
    if (localStorage.getItem(topicOwnerKey) !== token) throw new Error('storage unavailable');
    return { 'x-topic-owner': token };
  } catch {
    if (required) throw new ApiError('お題の作成者情報を保存できません。ブラウザーの保存設定を確認してください。');
    return {};
  }
}

export const api = {
  listTopics: () => request<SavedTopic[]>('/api/topics', { headers: topicOwnerHeaders() }),
  createTopic: async (body: { title: string; names: string; isPublic: boolean }) =>
    request<SavedTopic>('/api/topics', { method: 'POST', headers: topicOwnerHeaders(true), body: JSON.stringify(body) }),
  createRoom: (body: { name: string; topicId: string; teamSize: number }) =>
    request<Credentials>('/api/rooms', { method: 'POST', headers: topicOwnerHeaders(), body: JSON.stringify(body) }),
  getInvitation: ({ roomId, token }: Credentials) => request<InvitationLink>(
    `/api/rooms/${encodeURIComponent(roomId)}/invitation`, { headers: authorization(token) },
  ),
  rotateInvitation: ({ roomId, token }: Credentials) => request<InvitationLink>(
    `/api/rooms/${encodeURIComponent(roomId)}/invitation`, { method: 'POST', headers: authorization(token) },
  ),
  getInvitationInfo: (inviteKey: string) => request<InvitationInfo>('/api/invitations/resolve', {
    method: 'POST', body: JSON.stringify({ inviteKey }),
  }),
  joinInvitation: (inviteKey: string, name: string) => request<Credentials>('/api/invitations/join', {
    method: 'POST', body: JSON.stringify({ inviteKey, name }),
  }),
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
