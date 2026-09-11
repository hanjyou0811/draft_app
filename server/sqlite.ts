import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { Room } from '../shared/types.js';
import { RepositoryConflictError, type RoomRepository } from './repository.js';

export const ROOM_STORAGE_VERSION = 1;

interface RoomRow {
  readonly version: number | bigint;
  readonly storage_version: number | bigint;
  readonly aggregate: string;
}

export class SqliteRoomRepository implements RoomRepository {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:' && !path.startsWith('file:')) {
      mkdirSync(dirname(resolve(path)), { recursive: true });
    }
    this.#database = new DatabaseSync(path);
    this.#database.exec('PRAGMA journal_mode = WAL');
    this.#initializeSchema();
  }

  async get(id: string): Promise<Room | undefined> {
    const row = this.#database.prepare(`
      SELECT version, storage_version, aggregate
      FROM rooms
      WHERE id = ?
    `).get(id) as unknown as RoomRow | undefined;
    if (row === undefined) return undefined;
    if (Number(row.storage_version) !== ROOM_STORAGE_VERSION) {
      throw new Error(`unsupported room storage version: ${String(row.storage_version)}`);
    }

    const room = JSON.parse(row.aggregate) as Room;
    if (room.id !== id || room.version !== Number(row.version)) {
      throw new Error('stored room aggregate metadata does not match its payload');
    }
    return room;
  }

  async create(room: Room): Promise<void> {
    try {
      this.#database.prepare(`
        INSERT INTO rooms (id, version, storage_version, aggregate)
        VALUES (?, ?, ?, ?)
      `).run(room.id, room.version, ROOM_STORAGE_VERSION, JSON.stringify(room));
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new RepositoryConflictError('room already exists');
      }
      throw error;
    }
  }

  async save(room: Room, expectedVersion: number): Promise<void> {
    const result = this.#database.prepare(`
      UPDATE rooms
      SET version = ?, storage_version = ?, aggregate = ?
      WHERE id = ? AND version = ?
    `).run(
      room.version,
      ROOM_STORAGE_VERSION,
      JSON.stringify(room),
      room.id,
      expectedVersion,
    );
    if (Number(result.changes) !== 1) {
      throw new RepositoryConflictError();
    }
  }

  close(): void {
    this.#database.close();
  }

  #initializeSchema(): void {
    const result = this.#database.prepare('PRAGMA user_version').get() as
      | { user_version: number | bigint }
      | undefined;
    const version = Number(result?.user_version ?? 0);
    if (version === 0) {
      this.#database.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
          id TEXT PRIMARY KEY,
          version INTEGER NOT NULL,
          storage_version INTEGER NOT NULL,
          aggregate TEXT NOT NULL
        ) STRICT;
        PRAGMA user_version = ${ROOM_STORAGE_VERSION};
      `);
      return;
    }
    if (version !== ROOM_STORAGE_VERSION) {
      throw new Error(`unsupported database schema version: ${version}`);
    }
  }
}
