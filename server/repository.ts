import type { Room, SavedTopic } from '../shared/types.js';

export interface StoredTopic extends Omit<SavedTopic, 'isOwner'> { readonly ownerHash: string }

export interface RoomRepository {
  getTopic(id: string): Promise<StoredTopic | undefined>;
  listTopics(ownerHash?: string): Promise<StoredTopic[]>;
  createTopic(topic: StoredTopic): Promise<void>;
  get(id: string): Promise<Room | undefined>;
  create(room: Room): Promise<void>;
  save(room: Room, expectedVersion: number): Promise<void>;
}

export class RepositoryConflictError extends Error {
  constructor(message = 'room aggregate version conflict') {
    super(message);
    this.name = 'RepositoryConflictError';
  }
}
