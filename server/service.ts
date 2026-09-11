import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  createRoom as createRoomAggregate,
  joinRoom as joinRoomAggregate,
  startRoom as startRoomAggregate,
  submitPick,
  toView,
} from '../domain/draft.js';
import type { Credentials, Room, RoomView } from '../shared/types.js';
import { RepositoryConflictError, type RoomRepository } from './repository.js';

export type ServiceErrorCode = 'ROOM_NOT_FOUND' | 'UNAUTHORIZED';

export class ServiceError extends Error {
  constructor(readonly code: ServiceErrorCode) {
    super(code);
    this.name = 'ServiceError';
  }
}

export interface CreateRoomRequest {
  readonly name: string;
  readonly names: string;
  readonly teamSize: number;
}

export interface JoinRoomRequest {
  readonly name: string;
}

export interface PickRequest {
  readonly candidateId: string;
  readonly round: number;
  readonly attempt: number;
}

export interface RoomInfo {
  readonly status: Room['status'];
  readonly teamSize: number;
  readonly participantCount: number;
}

export interface RoomSubscription {
  unsubscribe(): void;
}

export interface DraftServiceOptions {
  readonly createId?: () => string;
  readonly createToken?: () => string;
  readonly chooseIndex?: (length: number) => number;
}

type ViewListener = (view: RoomView) => void;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class DraftService {
  readonly #queues = new Map<string, Promise<void>>();
  readonly #subscriptions = new Map<string, Map<string, Set<ViewListener>>>();
  readonly #createId: () => string;
  readonly #createToken: () => string;
  readonly #chooseIndex: (length: number) => number;

  constructor(
    readonly repository: RoomRepository,
    options: DraftServiceOptions = {},
  ) {
    this.#createId = options.createId ?? randomUUID;
    this.#createToken = options.createToken ?? (() => randomBytes(32).toString('base64url'));
    this.#chooseIndex = options.chooseIndex ?? randomInt;
  }

  async createRoom(input: CreateRoomRequest): Promise<Credentials> {
    for (;;) {
      const roomId = this.#createId();
      const memberId = this.#createId();
      const token = this.#createToken();
      const candidates = input.names
        .split(/\r?\n/u)
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
        .map((name) => ({ id: this.#createId(), name }));
      const room = createRoomAggregate({
        id: roomId,
        host: { id: memberId, name: input.name, tokenHash: hashToken(token) },
        candidates,
        teamSize: input.teamSize,
      });
      try {
        await this.#enqueue(roomId, () => this.repository.create(room));
        return { roomId, token };
      } catch (error) {
        if (!(error instanceof RepositoryConflictError)) throw error;
      }
    }
  }

  async getInfo(roomId: string): Promise<RoomInfo> {
    return this.#enqueue(roomId, async () => {
      const room = await this.#requireRoom(roomId);
      return {
        status: room.status,
        teamSize: room.teamSize,
        participantCount: room.members.length,
      };
    });
  }

  async joinRoom(roomId: string, input: JoinRoomRequest): Promise<Credentials> {
    return this.#enqueue(roomId, () => this.#retryConflict(async () => {
      const room = await this.#requireRoom(roomId);
      const token = this.#createToken();
      const next = joinRoomAggregate(room, {
        id: this.#createId(),
        name: input.name,
        tokenHash: hashToken(token),
      });
      await this.repository.save(next, room.version);
      this.#notify(next);
      return { roomId, token };
    }));
  }

  async getRoom(credentials: Credentials): Promise<RoomView> {
    return this.#enqueue(credentials.roomId, async () => {
      const room = await this.#requireRoom(credentials.roomId);
      return toView(room, this.#authenticate(room, credentials.token));
    });
  }

  async startRoom(credentials: Credentials): Promise<RoomView> {
    return this.#mutate(credentials, (room, memberId) =>
      startRoomAggregate(room, memberId));
  }

  async submitPick(credentials: Credentials, input: PickRequest): Promise<RoomView> {
    return this.#mutate(credentials, (room, memberId) =>
      submitPick(
        room,
        memberId,
        input.candidateId,
        { round: input.round, attempt: input.attempt },
        this.#chooseIndex,
      ));
  }

  async subscribe(
    credentials: Credentials,
    listener: ViewListener,
  ): Promise<RoomSubscription> {
    return this.#enqueue(credentials.roomId, async () => {
      const room = await this.#requireRoom(credentials.roomId);
      const memberId = this.#authenticate(room, credentials.token);
      const members = this.#subscriptions.get(room.id) ?? new Map<string, Set<ViewListener>>();
      const listeners = members.get(memberId) ?? new Set<ViewListener>();
      listeners.add(listener);
      members.set(memberId, listeners);
      this.#subscriptions.set(room.id, members);
      listener(toView(room, memberId));

      let subscribed = true;
      return {
        unsubscribe: () => {
          if (!subscribed) return;
          subscribed = false;
          listeners.delete(listener);
          if (listeners.size === 0) members.delete(memberId);
          if (members.size === 0) this.#subscriptions.delete(room.id);
        },
      };
    });
  }

  async #mutate(
    credentials: Credentials,
    transition: (room: Room, memberId: string) => Room,
  ): Promise<RoomView> {
    return this.#enqueue(credentials.roomId, () => this.#retryConflict(async () => {
      const room = await this.#requireRoom(credentials.roomId);
      const memberId = this.#authenticate(room, credentials.token);
      const next = transition(room, memberId);
      if (next.version !== room.version) {
        await this.repository.save(next, room.version);
        this.#notify(next);
      }
      return toView(next, memberId);
    }));
  }

  async #retryConflict<T>(action: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try { return await action(); }
      catch (error) {
        if (!(error instanceof RepositoryConflictError) || attempt >= 24) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(5 * (attempt + 1), 100)));
      }
    }
  }

  async #requireRoom(roomId: string): Promise<Room> {
    const room = await this.repository.get(roomId);
    if (room === undefined) throw new ServiceError('ROOM_NOT_FOUND');
    return room;
  }

  #authenticate(room: Room, token: string): string {
    if (typeof token !== 'string' || token.length === 0) {
      throw new ServiceError('UNAUTHORIZED');
    }
    const suppliedHash = Buffer.from(hashToken(token), 'hex');
    const member = room.members.find(({ tokenHash }) => {
      const storedHash = Buffer.from(tokenHash, 'hex');
      return storedHash.length === suppliedHash.length && timingSafeEqual(storedHash, suppliedHash);
    });
    if (member === undefined) throw new ServiceError('UNAUTHORIZED');
    return member.id;
  }

  #notify(room: Room): void {
    const members = this.#subscriptions.get(room.id);
    if (members === undefined) return;
    for (const [memberId, listeners] of members) {
      const view = toView(room, memberId);
      for (const listener of listeners) {
        try {
          listener(view);
        } catch {
          // A broken transport is removed by its own close handler.
        }
      }
    }
  }

  #enqueue<T>(roomId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(roomId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(action);
    const settled = result.then(() => undefined, () => undefined);
    this.#queues.set(roomId, settled);
    void settled.finally(() => {
      if (this.#queues.get(roomId) === settled) this.#queues.delete(roomId);
    });
    return result;
  }
}
