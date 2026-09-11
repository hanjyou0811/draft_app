import type { Room } from '../shared/types.js';

export interface RoomRepository {
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
