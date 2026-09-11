import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import WebSocket from 'ws';

import { createRoom, joinRoom } from '../domain/draft.js';
import type { Room } from '../shared/types.js';
import { RepositoryConflictError } from './repository.js';
import { SqliteRoomRepository } from './sqlite.js';
import { createDraftServer, type DraftServer } from './http.js';
import { readServerConfig } from './index.js';

const temporaryDirectories: string[] = [];
const runningServers: DraftServer[] = [];
const runningSockets: WebSocket[] = [];

async function temporaryDatabase(): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'draft-room-'));
  temporaryDirectories.push(directory);
  return { directory, path: join(directory, 'rooms.sqlite') };
}

function roomFixture(): Room {
  const created = createRoom({
    id: 'room-1',
    host: { id: 'host-1', name: '主催', tokenHash: 'host-token-hash' },
    candidates: [
      { id: 'candidate-1', name: '候補 A' },
      { id: 'candidate-2', name: '候補 B' },
    ],
    teamSize: 1,
  });
  return joinRoom(created, {
    id: 'guest-1',
    name: '参加者',
    tokenHash: 'guest-token-hash',
  });
}

afterEach(async () => {
  for (const socket of runningSockets.splice(0)) socket.terminate();
  await Promise.all(runningServers.splice(0).map((server) => server.close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

interface JsonResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

function nextJson(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolveMessage, reject) => {
    const timeout = setTimeout(() => reject(new Error('timed out waiting for WebSocket message')), 1_000);
    socket.once('message', (data) => {
      clearTimeout(timeout);
      resolveMessage(JSON.parse(data.toString()) as Record<string, unknown>);
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function authenticatedSocket(
  origin: string,
  roomId: string,
  token: string,
): Promise<{ socket: WebSocket; snapshot: Record<string, unknown> }> {
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/ws`, { origin });
  runningSockets.push(socket);
  await new Promise<void>((resolveOpen, reject) => {
    socket.once('open', resolveOpen);
    socket.once('error', reject);
  });
  const snapshot = nextJson(socket);
  socket.send(JSON.stringify({ roomId, token }));
  return { socket, snapshot: await snapshot };
}

async function startTestServer(
  databasePath: string,
  options: { staticDirectory?: string; chooseIndex?: (length: number) => number } = {},
): Promise<{ server: DraftServer; origin: string }> {
  const server = createDraftServer({
    databasePath,
    ...(options.staticDirectory === undefined ? {} : { staticDirectory: options.staticDirectory }),
    ...(options.chooseIndex === undefined ? {} : { chooseIndex: options.chooseIndex }),
    authenticationTimeoutMs: 100,
    heartbeatIntervalMs: 100,
  });
  runningServers.push(server);
  const address = await server.listen(0, '127.0.0.1');
  return { server, origin: address.origin };
}

async function jsonRequest(
  origin: string,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<JsonResponse> {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function createBasicRoom(origin: string, names = '候補 A\n候補 B'): Promise<{
  roomId: string;
  token: string;
}> {
  const response = await jsonRequest(origin, 'POST', '/api/rooms', {
    name: '主催',
    names,
    teamSize: 1,
  });
  assert.equal(response.status, 201);
  assert.equal(typeof response.body.roomId, 'string');
  assert.equal(typeof response.body.token, 'string');
  return response.body as { roomId: string; token: string };
}

describe('SqliteRoomRepository', () => {
  test('persists a complete room aggregate across repository restarts', async () => {
    const { path } = await temporaryDatabase();
    const original = roomFixture();
    const first = new SqliteRoomRepository(path);
    await first.create(original);
    first.close();

    const reopened = new SqliteRoomRepository(path);
    assert.deepEqual(await reopened.get(original.id), original);
    assert.equal(await reopened.get('missing-room'), undefined);
    reopened.close();
  });

  test('compares the expected version when replacing an aggregate', async () => {
    const { path } = await temporaryDatabase();
    const repository = new SqliteRoomRepository(path);
    const original = roomFixture();
    await repository.create(original);
    const next = { ...original, version: original.version + 1 };

    await repository.save(next, original.version);
    await assert.rejects(
      repository.save({ ...next, version: next.version + 1 }, original.version),
      RepositoryConflictError,
    );
    assert.deepEqual(await repository.get(original.id), next);
    repository.close();
  });

  test('creates the parent directory for a configured database file', async () => {
    const { directory } = await temporaryDatabase();
    const path = join(directory, 'nested', 'data', 'rooms.sqlite');
    const repository = new SqliteRoomRepository(path);
    const room = roomFixture();
    await repository.create(room);
    assert.deepEqual(await repository.get(room.id), room);
    repository.close();
  });
});

describe('server configuration', () => {
  test('uses documented defaults and accepts PORT, HOST, and DATABASE_PATH', () => {
    assert.deepEqual(readServerConfig({}), {
      port: 3001,
      host: '0.0.0.0',
      databasePath: 'data/draft-room.sqlite',
    });
    assert.deepEqual(readServerConfig({
      PORT: '4321',
      HOST: '127.0.0.1',
      DATABASE_PATH: '/tmp/custom.sqlite',
    }), {
      port: 4321,
      host: '127.0.0.1',
      databasePath: '/tmp/custom.sqlite',
    });
    assert.throws(() => readServerConfig({ PORT: 'invalid' }), /PORT/);
  });
});

describe('HTTP API', () => {
  test('creates, joins, reports public info, and requires a valid bearer token', async () => {
    const { path } = await temporaryDatabase();
    const { origin } = await startTestServer(path);
    const created = await createBasicRoom(origin);

    const info = await jsonRequest(origin, 'GET', `/api/rooms/${created.roomId}/info`);
    assert.deepEqual(info, {
      status: 200,
      body: { status: 'waiting', teamSize: 1, participantCount: 1 },
    });
    assert.equal(JSON.stringify(info.body).includes('token'), false);
    assert.equal(JSON.stringify(info.body).includes('members'), false);

    const missingToken = await jsonRequest(origin, 'GET', `/api/rooms/${created.roomId}`);
    assert.deepEqual(missingToken, {
      status: 401,
      body: { error: '認証情報が正しくありません。' },
    });
    const wrongToken = await jsonRequest(origin, 'GET', `/api/rooms/${created.roomId}`, undefined, 'wrong');
    assert.deepEqual(wrongToken, missingToken);

    const joined = await jsonRequest(origin, 'POST', `/api/rooms/${created.roomId}/join`, {
      name: '参加者',
    });
    assert.equal(joined.status, 201);
    assert.equal(joined.body.roomId, created.roomId);
    assert.equal(typeof joined.body.token, 'string');

    const duplicate = await jsonRequest(origin, 'POST', `/api/rooms/${created.roomId}/join`, {
      name: ' 参加者 ',
    });
    assert.deepEqual(duplicate, {
      status: 409,
      body: { error: '同じ表示名の参加者がいます。' },
    });

    const stored = new SqliteRoomRepository(path);
    const aggregate = await stored.get(created.roomId);
    assert.equal(aggregate?.members.some(({ tokenHash }) => tokenHash === created.token), false);
    assert.equal(aggregate?.members.some(({ tokenHash }) => tokenHash === joined.body.token), false);
    assert.equal(JSON.stringify(aggregate).includes(created.token), false);
    assert.equal(JSON.stringify(aggregate).includes(joined.body.token as string), false);
    stored.close();
  });

  test('rejects malformed JSON and invalid runtime body types without exposing internals', async () => {
    const { path } = await temporaryDatabase();
    const { origin } = await startTestServer(path);
    const malformed = await fetch(`${origin}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: 'リクエストの形式が正しくありません。' });

    for (const body of [null, [], { name: null, names: 'A', teamSize: 1 }, {
      name: '主催', names: ['A'], teamSize: 1,
    }]) {
      const response = await jsonRequest(origin, 'POST', '/api/rooms', body);
      assert.equal(response.status, 400);
      assert.equal(typeof response.body.error, 'string');
      assert.equal(JSON.stringify(response.body).includes('stack'), false);
    }
  });

  test('maps missing rooms, host-only start, late join, and invalid pick fields', async () => {
    const { path } = await temporaryDatabase();
    const { origin } = await startTestServer(path);
    assert.deepEqual(await jsonRequest(origin, 'GET', '/api/rooms/missing/info'), {
      status: 404,
      body: { error: '会議が見つかりません。' },
    });

    const created = await createBasicRoom(origin);
    const joined = await jsonRequest(origin, 'POST', `/api/rooms/${created.roomId}/join`, { name: '参加者' });
    const guestToken = joined.body.token as string;
    assert.equal((await jsonRequest(origin, 'POST', `/api/rooms/${created.roomId}/start`, {})).status, 401);
    assert.equal((await jsonRequest(origin, 'POST', `/api/rooms/${created.roomId}/picks`, {
      candidateId: 'x', round: 1, attempt: 1,
    })).status, 401);
    const guestStart = await jsonRequest(origin, 'POST', `/api/rooms/${created.roomId}/start`, {}, guestToken);
    assert.deepEqual(guestStart, {
      status: 400,
      body: { error: '開始できるのは作成者だけです。' },
    });

    const started = await jsonRequest(origin, 'POST', `/api/rooms/${created.roomId}/start`, {}, created.token);
    assert.equal(started.status, 200, 'a rejected queued action must not poison later actions');
    const lateJoin = await jsonRequest(origin, 'POST', `/api/rooms/${created.roomId}/join`, { name: '遅刻' });
    assert.deepEqual(lateJoin, {
      status: 409,
      body: { error: 'この会議はすでに開始されています。' },
    });

    for (const body of [null, [], { candidateId: null, round: 1, attempt: 1 }, {
      candidateId: 'x', round: '1', attempt: 1,
    }]) {
      const response = await jsonRequest(
        origin,
        'POST',
        `/api/rooms/${created.roomId}/picks`,
        body,
        created.token,
      );
      assert.equal(response.status, 400);
    }
  });

  test('serializes simultaneous picks and makes a committed retry idempotent', async () => {
    const { path } = await temporaryDatabase();
    let lotteryCalls = 0;
    const { origin } = await startTestServer(path, {
      chooseIndex: (length) => {
        lotteryCalls += 1;
        assert.equal(length, 2);
        return 0;
      },
    });
    const created = await createBasicRoom(origin);
    const joined = await jsonRequest(origin, 'POST', `/api/rooms/${created.roomId}/join`, { name: '参加者' });
    const guestToken = joined.body.token as string;
    const started = await jsonRequest(origin, 'POST', `/api/rooms/${created.roomId}/start`, {}, created.token);
    const candidateId = (started.body.candidates as Array<{ id: string }>)[0]?.id;
    assert.equal(typeof candidateId, 'string');

    const submission = { candidateId, round: 1, attempt: 1 };
    const [hostPick, guestPick] = await Promise.all([
      jsonRequest(origin, 'POST', `/api/rooms/${created.roomId}/picks`, submission, created.token),
      jsonRequest(origin, 'POST', `/api/rooms/${created.roomId}/picks`, submission, guestToken),
    ]);
    assert.equal(hostPick.status, 200);
    assert.equal(guestPick.status, 200);

    const committed = await jsonRequest(origin, 'GET', `/api/rooms/${created.roomId}`, undefined, guestToken);
    assert.equal((committed.body.history as unknown[]).length, 1);
    assert.equal(committed.body.version, 5);
    assert.equal(lotteryCalls, 1);

    const retried = await jsonRequest(
      origin,
      'POST',
      `/api/rooms/${created.roomId}/picks`,
      submission,
      guestToken,
    );
    assert.equal(retried.status, 200);
    assert.equal(retried.body.version, 5);
    assert.equal((retried.body.history as unknown[]).length, 1);
    assert.equal(lotteryCalls, 1);
  });

  test('recovers rooms and credentials after a server restart', async () => {
    const { path } = await temporaryDatabase();
    const first = await startTestServer(path);
    const created = await createBasicRoom(first.origin);
    await first.server.close();
    runningServers.splice(runningServers.indexOf(first.server), 1);

    const second = await startTestServer(path);
    const restored = await jsonRequest(
      second.origin,
      'GET',
      `/api/rooms/${created.roomId}`,
      undefined,
      created.token,
    );
    assert.equal(restored.status, 200);
    assert.equal(restored.body.id, created.roomId);
    assert.equal(restored.body.status, 'waiting');
  });

  test('uses SPA fallback only for UI GET routes', async () => {
    const { directory, path } = await temporaryDatabase();
    const staticDirectory = join(directory, 'dist');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(staticDirectory));
    await writeFile(join(staticDirectory, 'index.html'), '<!doctype html><title>Draft room</title>');
    const { origin } = await startTestServer(path, { staticDirectory });

    const ui = await fetch(`${origin}/room/example`, { headers: { accept: 'text/html' } });
    assert.equal(ui.status, 200);
    assert.match(await ui.text(), /Draft room/);

    for (const pathname of ['/api', '/api/unknown']) {
      const api = await fetch(`${origin}${pathname}`, { headers: { accept: 'text/html' } });
      assert.equal(api.status, 404);
      assert.match(api.headers.get('content-type') ?? '', /application\/json/);
      assert.deepEqual(await api.json(), { error: 'APIが見つかりません。' });
    }
  });
});

describe('WebSocket updates', () => {
  test('authenticates in the first frame and sends personalized state after durable picks', async () => {
    const { path } = await temporaryDatabase();
    const { origin } = await startTestServer(path);
    const created = await createBasicRoom(origin);
    const joined = await jsonRequest(origin, 'POST', `/api/rooms/${created.roomId}/join`, { name: '参加者' });
    const guestToken = joined.body.token as string;
    const started = await jsonRequest(origin, 'POST', `/api/rooms/${created.roomId}/start`, {}, created.token);
    const candidateId = (started.body.candidates as Array<{ id: string }>)[0]?.id as string;

    const host = await authenticatedSocket(origin, created.roomId, created.token);
    const guest = await authenticatedSocket(origin, created.roomId, guestToken);
    assert.equal(host.snapshot.type, 'snapshot');
    assert.equal(guest.snapshot.type, 'snapshot');

    const hostUpdate = nextJson(host.socket);
    const guestUpdate = nextJson(guest.socket);
    const picked = await jsonRequest(origin, 'POST', `/api/rooms/${created.roomId}/picks`, {
      candidateId,
      round: 1,
      attempt: 1,
    }, created.token);
    assert.equal(picked.status, 200);

    const hostRoom = (await hostUpdate).room as Record<string, unknown>;
    const guestRoom = (await guestUpdate).room as Record<string, unknown>;
    assert.deepEqual(hostRoom.ownSubmission, { candidateId, round: 1, attempt: 1 });
    assert.equal(guestRoom.ownSubmission, undefined);
    assert.equal(
      (guestRoom.members as Array<{ id: string; submitted: boolean }>)
        .find(({ id }) => id === hostRoom.ownMemberId)?.submitted,
      true,
    );
    assert.equal(JSON.stringify(guestRoom).includes('tokenHash'), false);

    const guestHttp = await jsonRequest(
      origin,
      'GET',
      `/api/rooms/${created.roomId}`,
      undefined,
      guestToken,
    );
    assert.equal(guestHttp.body.ownSubmission, undefined);

    guest.socket.close();
    const reconnected = await authenticatedSocket(origin, created.roomId, guestToken);
    const reconnectRoom = reconnected.snapshot.room as Record<string, unknown>;
    assert.equal(reconnectRoom.version, guestRoom.version);
    assert.equal(reconnectRoom.ownSubmission, undefined);
  });

  test('closes clients that do not authenticate in time', async () => {
    const { path } = await temporaryDatabase();
    const { origin } = await startTestServer(path);
    const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/ws`, { origin });
    runningSockets.push(socket);
    await new Promise<void>((resolveOpen, reject) => {
      socket.once('open', resolveOpen);
      socket.once('error', reject);
    });
    const [code] = await new Promise<[number, Buffer]>((resolveClose) => socket.once('close', (...args) => resolveClose(args)));
    assert.equal(code, 1008);
  });

  test('rejects a malformed authentication frame without crashing the server', async () => {
    const { path } = await temporaryDatabase();
    const { origin } = await startTestServer(path);
    const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/ws`, { origin });
    runningSockets.push(socket);
    await new Promise<void>((resolveOpen, reject) => {
      socket.once('open', resolveOpen);
      socket.once('error', reject);
    });
    const errorMessage = nextJson(socket);
    socket.send('{');
    assert.deepEqual(await errorMessage, {
      type: 'error',
      error: '認証情報が正しくありません。',
    });
    const response = await fetch(`${origin}/api/unknown`);
    assert.equal(response.status, 404);
  });

  test('rejects an oversized frame while keeping HTTP and new sockets available', async () => {
    const { path } = await temporaryDatabase();
    const { origin } = await startTestServer(path);
    const oversized = new WebSocket(`${origin.replace('http:', 'ws:')}/ws`, { origin });
    runningSockets.push(oversized);
    await new Promise<void>((resolveOpen, reject) => {
      oversized.once('open', resolveOpen);
      oversized.once('error', reject);
    });
    const closed = new Promise<number>((resolveClose) => {
      oversized.once('close', (code) => resolveClose(code));
      oversized.once('error', () => undefined);
    });
    oversized.send('x'.repeat(16 * 1024 + 1));
    assert.equal(await closed, 1009);

    const created = await createBasicRoom(origin);
    const connected = await authenticatedSocket(origin, created.roomId, created.token);
    assert.equal(connected.snapshot.type, 'snapshot');
    assert.equal((connected.snapshot.room as Record<string, unknown>).id, created.roomId);
  });

  test('rejects browser WebSockets from a mismatched Origin', async () => {
    const { path } = await temporaryDatabase();
    const { origin } = await startTestServer(path);
    const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/ws`, {
      origin: 'https://attacker.example',
    });
    runningSockets.push(socket);
    const status = await new Promise<number>((resolveStatus, reject) => {
      socket.once('unexpected-response', (_request, response) => {
        response.resume();
        resolveStatus(response.statusCode ?? 0);
      });
      socket.once('open', () => reject(new Error('cross-origin socket unexpectedly opened')));
      socket.once('error', () => undefined);
    });
    assert.equal(status, 403);
  });
});
