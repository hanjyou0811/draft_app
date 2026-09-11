import type { Room } from '../shared/types.js';
import { RepositoryConflictError, type RoomRepository } from './repository.js';

interface RoomRow { id: string; version: number; storage_version: number; aggregate: Room }

export class SupabaseRoomRepository implements RoomRepository {
  readonly #endpoint: string;
  constructor(url: string, readonly key: string, readonly fetcher: typeof fetch = fetch) {
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required');
    this.#endpoint = new URL('/rest/v1/draft_rooms', url).toString();
  }

  async #request(query: URLSearchParams, method = 'GET', body?: RoomRow): Promise<Response> {
    const headers: Record<string, string> = { apikey: this.key, 'content-type': 'application/json' };
    // Legacy service_role keys are JWTs; new secret keys go only in apikey.
    if (!this.key.startsWith('sb_secret_')) headers.authorization = `Bearer ${this.key}`;
    if (method === 'PATCH') headers.prefer = 'return=representation';
    const response = await this.fetcher(`${this.#endpoint}?${query}`, {
      method, headers, signal: AbortSignal.timeout(8_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { code?: string };
      if (method === 'POST' && error.code === '23505') throw new RepositoryConflictError();
      throw new Error(`Supabase request failed (${response.status})`);
    }
    return response;
  }

  async get(id: string): Promise<Room | undefined> {
    const response = await this.#request(new URLSearchParams({ id: `eq.${id}`, select: '*', limit: '1' }));
    const [row] = await response.json() as RoomRow[];
    if (row === undefined) return undefined;
    if (row.storage_version !== 1 || row.aggregate.id !== id || row.aggregate.version !== row.version) {
      throw new Error('Stored room metadata is invalid');
    }
    return row.aggregate;
  }

  #row(room: Room): RoomRow {
    return { id: room.id, version: room.version, storage_version: 1, aggregate: room };
  }

  async create(room: Room): Promise<void> {
    await this.#request(new URLSearchParams(), 'POST', this.#row(room));
  }

  async save(room: Room, expectedVersion: number): Promise<void> {
    const response = await this.#request(new URLSearchParams({
      id: `eq.${room.id}`, version: `eq.${expectedVersion}`, select: 'id',
    }), 'PATCH', this.#row(room));
    const rows = await response.json() as { id: string }[];
    if (rows.length !== 1) throw new RepositoryConflictError();
  }
}
