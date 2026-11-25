import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  createRoom as createRoomAggregate,
  joinRoom as joinRoomAggregate,
  startRoom as startRoomAggregate,
  submitPick,
  toView,
} from '../domain/draft.js';
import type { Credentials, Room, RoomView, SavedTopic } from '../shared/types.js';
import { RepositoryConflictError, type RoomRepository, type StoredTopic } from './repository.js';

export type ServiceErrorCode = 'ROOM_NOT_FOUND' | 'TOPIC_NOT_FOUND' | 'INVALID_TOPIC' | 'INVALID_TOPIC_OWNER' | 'UNAUTHORIZED' | 'INVITATION_REQUIRED' | 'INVITATION_NOT_FOUND' | 'INVITATION_HOST_ONLY' | 'INVITATION_NOT_WAITING';

export class ServiceError extends Error {
  constructor(readonly code: ServiceErrorCode) {
    super(code);
    this.name = 'ServiceError';
  }
}

export interface CreateRoomRequest {
  readonly topic?: string;
  readonly name: string;
  readonly names?: string;
  readonly topicId?: string;
  readonly teamSize: number;
}

export interface JoinRoomRequest {
  readonly inviteKey?: string;
  readonly name: string;
}

export interface PickRequest {
  readonly candidateId: string;
  readonly round: number;
  readonly attempt: number;
}

export interface RoomInfo {
  readonly topic?: string;
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

  async createTopic(input: { title: string; names: string; isPublic?: boolean }, ownerToken?: string): Promise<SavedTopic> {
    const ownerHash = this.#ownerHash(ownerToken);
    if (!ownerHash) throw new ServiceError('INVALID_TOPIC_OWNER');
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const candidates = typeof input.names === 'string' ? input.names.split(/\r?\n/u).map(name => name.trim()).filter(Boolean) : [];
    if (!title || title.length > 100 || !candidates.length || candidates.length > 500 ||
        candidates.some(name => name.length > 100) || new Set(candidates).size !== candidates.length ||
        (input.isPublic !== undefined && typeof input.isPublic !== 'boolean')) throw new ServiceError('INVALID_TOPIC');
    for (;;) {
      const topic: StoredTopic = { id: this.#createId(), title, candidates, isPublic: input.isPublic ?? false, createdAt: new Date().toISOString(), ownerHash };
      try { await this.repository.createTopic(topic); return this.#topicView(topic, ownerHash); }
      catch (error) { if (!(error instanceof RepositoryConflictError)) throw error; }
    }
  }

  async listTopics(ownerToken?: string): Promise<SavedTopic[]> {
    const ownerHash = this.#ownerHash(ownerToken);
    return (await this.repository.listTopics(ownerHash)).filter(topic => topic.isPublic || topic.ownerHash === ownerHash).map(topic => this.#topicView(topic, ownerHash));
  }

  #ownerHash(token?: string): string | undefined {
    if (token === undefined) return undefined;
    if (typeof token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(token)) throw new ServiceError('INVALID_TOPIC_OWNER');
    return hashToken(token);
  }

  #topicView(topic: StoredTopic, ownerHash?: string): SavedTopic {
    return { id: topic.id, title: topic.title, candidates: [...topic.candidates], isPublic: topic.isPublic, createdAt: topic.createdAt, isOwner: topic.ownerHash === ownerHash };
  }

  async createRoom(input: CreateRoomRequest, ownerToken?: string): Promise<Credentials> {
    const ownerHash = this.#ownerHash(ownerToken);
    if (input.topicId !== undefined) {
      if (typeof input.topicId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/u.test(input.topicId)) throw new ServiceError('TOPIC_NOT_FOUND');
      const topic = await this.repository.getTopic(input.topicId);
      if (!topic || (!topic.isPublic && topic.ownerHash !== ownerHash)) throw new ServiceError('TOPIC_NOT_FOUND');
      input = { name: input.name, teamSize: input.teamSize, topic: topic.title, names: topic.candidates.join('\n') };
    }

    for (;;) {
      const roomId = this.#createId();
      const memberId = this.#createId();
      const token = this.#createToken();
      const candidates = (input.names ?? '')
        .split(/\r?\n/u)
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
        .map((name) => ({ id: this.#createId(), name }));
      const room = createRoomAggregate({
        id: roomId,
        host: { id: memberId, name: input.name, tokenHash: hashToken(token) },
        candidates,
        teamSize: input.teamSize,
        ...(input.topic !== undefined ? { topic: input.topic } : {}),
      });
      try {
        await this.#enqueue(roomId, () => this.repository.create({ ...room, invitation: this.#newInvitation(roomId, token) }));
        return { roomId, token };
      } catch (error) {
        if (!(error instanceof RepositoryConflictError)) throw error;
      }
    }
  }

  #secret(roomId: string, token: string, nonce: string): string {
    return createHmac('sha256', token).update(JSON.stringify(['draft-room/invitation/v1', roomId, nonce])).digest('hex');
  }

  #newInvitation(roomId: string, token: string): NonNullable<Room['invitation']> {
    const nonce = randomBytes(32).toString('hex');
    return { nonce, keyHash: hashToken(this.#secret(roomId, token, nonce)) };
  }

  #parseInvitation(inviteKey: string): { roomId: string; secret: string } {
    if (typeof inviteKey !== 'string' || inviteKey.length > 400) throw new ServiceError('INVITATION_NOT_FOUND');
    const separator = inviteKey.lastIndexOf('.');
    try {
      const roomId = decodeURIComponent(inviteKey.slice(0, separator));
      const secret = inviteKey.slice(separator + 1);
      if (separator < 1 || !/^[A-Za-z0-9_-]{1,100}$/u.test(roomId) || !/^[0-9a-f]{64}$/u.test(secret)) throw new Error();
      return { roomId, secret };
    } catch { throw new ServiceError('INVITATION_NOT_FOUND'); }
  }

  #checkInvitation(room: Room | undefined, inviteKey: string, roomId: string): asserts room is Room {
    const parsed = this.#parseInvitation(inviteKey);
    const stored = Buffer.from(room?.invitation?.keyHash ?? '', 'hex');
    const supplied = Buffer.from(hashToken(parsed.secret), 'hex');
    if (!room || parsed.roomId !== roomId || stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) {
      throw new ServiceError('INVITATION_NOT_FOUND');
    }
  }

  async getInvitation(credentials: Credentials): Promise<{ inviteKey: string }> {
    return this.#invitation(credentials, false);
  }

  async rotateInvitation(credentials: Credentials): Promise<{ inviteKey: string }> {
    return this.#invitation(credentials, true);
  }

  async #invitation(credentials: Credentials, rotate: boolean): Promise<{ inviteKey: string }> {
    return this.#enqueue(credentials.roomId, () => this.#retryConflict(async () => {
      const room = await this.#requireRoom(credentials.roomId);
      const memberId = this.#authenticate(room, credentials.token);
      if (!room.members.some(member => member.id === memberId && member.isHost)) throw new ServiceError('INVITATION_HOST_ONLY');
      if (room.status !== 'waiting') throw new ServiceError('INVITATION_NOT_WAITING');
      let invitation = room.invitation;
      if (rotate || !invitation) {
        invitation = this.#newInvitation(room.id, credentials.token);
        const next = { ...room, invitation, version: room.version + 1 };
        await this.repository.save(next, room.version);
        this.#notify(next);
      }
      return { inviteKey: encodeURIComponent(room.id) + '.' + this.#secret(room.id, credentials.token, invitation.nonce) };
    }));
  }

  async getInvitationInfo(inviteKey: string): Promise<RoomInfo & { roomId: string }> {
    const { roomId } = this.#parseInvitation(inviteKey);
    return { ...await this.getInfo(roomId, inviteKey), roomId };
  }

  async joinInvitation(inviteKey: string, input: { name: string }): Promise<Credentials> {
    const { roomId } = this.#parseInvitation(inviteKey);
    return this.joinRoom(roomId, { ...input, inviteKey });
  }

  async getInfo(roomId: string, inviteKey?: string): Promise<RoomInfo> {
    if (inviteKey === undefined) throw new ServiceError('INVITATION_REQUIRED');
    return this.#enqueue(roomId, async () => {
      const room = await this.repository.get(roomId);
      this.#checkInvitation(room, inviteKey, roomId);
      return {
        status: room.status,
        ...(room.topic ? { topic: room.topic } : {}),
        teamSize: room.teamSize,
        participantCount: room.members.length,
      };
    });
  }

  async joinRoom(roomId: string, input: JoinRoomRequest): Promise<Credentials> {
    return this.#enqueue(roomId, () => this.#retryConflict(async () => {
      if (input.inviteKey === undefined) throw new ServiceError('INVITATION_REQUIRED');
      const room = await this.repository.get(roomId);
      this.#checkInvitation(room, input.inviteKey, roomId);
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
