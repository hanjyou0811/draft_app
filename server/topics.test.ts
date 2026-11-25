import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DraftService } from './service.js';
import { SqliteRoomRepository } from './sqlite.js';
import { SupabaseRoomRepository } from './supabase.js';

const owner = () => randomUUID() + randomUUID();
test('topics persist privately, enforce ownership and copy independent room snapshots', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'topics-'));
  let repo = new SqliteRoomRepository(join(dir, 'db.sqlite'));
  try {
    let service = new DraftService(repo);
    const token = owner();
    const topic = await service.createTopic({ title: ' お題 ', names: ' A \nB' }, token);
    assert.deepEqual(topic.candidates, ['A', 'B']);
    assert.equal(topic.title, 'お題');
    assert.equal(topic.isPublic, false);
    assert.equal(topic.isOwner, true);
    assert.equal(JSON.stringify(topic).includes(token), false);
    assert.equal(JSON.stringify(topic).includes(createHash('sha256').update(token).digest('hex')), false);
    assert.deepEqual(await service.listTopics(), []);
    assert.deepEqual(await service.listTopics(owner()), []);
    await assert.rejects(service.createRoom({ name: 'Host', topicId: topic.id, teamSize: 1 }));
    await assert.rejects(service.createRoom({ name: 'Host', topicId: 'missing', teamSize: 1 }, token));
    const a = await service.createRoom({ name: 'Host', topicId: topic.id, teamSize: 1 }, token);
    const b = await service.createRoom({ name: 'Host', topicId: topic.id, teamSize: 1 }, token);
    const first = (await repo.get(a.roomId))!;
    const second = (await repo.get(b.roomId))!;
    assert.equal(first.topic, 'お題');
    assert.deepEqual(first.candidates.map(c => c.name), ['A', 'B']);
    assert.notEqual(first.candidates[0]?.id, second.candidates[0]?.id);
    repo.close();
    repo = new SqliteRoomRepository(join(dir, 'db.sqlite'));
    service = new DraftService(repo);
    assert.deepEqual(await service.listTopics(token), [topic]);
    const publicTopic = await service.createTopic({ title: 'Public', names: 'C', isPublic: true }, token);
    assert.equal((await service.listTopics())[0]?.isOwner, false);
    await service.createRoom({ name: 'Guest', topicId: publicTopic.id, teamSize: 1 });
  } finally { repo.close(); await rm(dir, { recursive: true, force: true }); }
});

test('topic validation rejects malformed owners and invalid topic inputs', async () => {
  const repo = new SqliteRoomRepository(':memory:');
  const service = new DraftService(repo);
  try {
    for (const token of [undefined, '', 'short', 'x'.repeat(1000)]) {
      await assert.rejects(service.createTopic({ title: 'Title', names: 'A' }, token));
    }
    for (const input of [
      { title: '', names: 'A' }, { title: 'x'.repeat(101), names: 'A' },
      { title: 'Title', names: '' }, { title: 'Title', names: ' A\nA ' },
      { title: 'Title', names: 'x'.repeat(101) },
      { title: 'Title', names: Array.from({ length: 501 }, (_, i) => String(i)).join('\n') },
      { title: 'Title', names: 'A', isPublic: 'true' },
    ]) await assert.rejects(service.createTopic(input as never, owner()));
    await assert.rejects(service.listTopics('short'));
  } finally { repo.close(); }
});

test('Supabase topics use durable separate rows with visibility constrained in query', async () => {
  const rows: any[] = [];
  const repo = new SupabaseRoomRepository('https://test.supabase.co', 'sb_secret_test', async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/rest/v1/draft_topics');
    assert.equal(new Headers(init?.headers).get('apikey'), 'sb_secret_test');
    if (init?.method === 'POST') { rows.push(JSON.parse(String(init.body))); return new Response(null, { status: 201 }); }
    const filter = url.searchParams.get('or');
    const id = url.searchParams.get('id');
    if (id) return Response.json(rows.filter(row => `eq.${row.id}` === id));
    assert.ok(filter === null ? url.searchParams.get('is_public') === 'eq.true' : filter.includes('is_public.eq.true,owner_hash.eq.'));
    return Response.json(rows.filter(row => row.is_public || filter?.includes(row.owner_hash)));
  });
  const service = new DraftService(repo);
  const token = owner();
  const topic = await service.createTopic({ title: 'Private', names: 'A' }, token);
  assert.equal(rows[0].owner_hash, createHash('sha256').update(token).digest('hex'));
  assert.equal(JSON.stringify(rows).includes(token), false);
  assert.deepEqual(await service.listTopics(), []);
  assert.deepEqual(await service.listTopics(token), [topic]);
  const sql = await readFile('supabase/migrations/20261110000000_saved_topics.sql', 'utf8');
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL ON.*draft_topics.*anon, authenticated/i);
});

test('HTTP topics hide private records and room creation resolves saved values over supplied overrides', async () => {
  const { createDraftServer } = await import('./http.js');
  const server = createDraftServer({ databasePath: ':memory:' });
  const { origin } = await server.listen(0, '127.0.0.1');
  const token = owner();
  const request = (path: string, body?: unknown, credential?: string) => fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(credential ? { 'x-topic-owner': credential } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    assert.equal((await request('/api/topics', { title: 'T', names: 'A' })).status, 400);
    const saved = await request('/api/topics', { title: 'Saved', names: 'A\nB' }, token);
    assert.equal(saved.status, 201);
    const topic = await saved.json() as { id: string };
    assert.deepEqual(await (await request('/api/topics')).json(), []);
    assert.equal((await request('/api/topics', undefined, 'malformed')).status, 400);
    for (const topicId of [topic.id, 'missing', 'x),is_public.eq.true', '../topic']) {
      assert.equal((await request('/api/rooms', { name: 'Host', topicId, teamSize: 1 }, owner())).status, 404);
    }
    const created = await request('/api/rooms', { name: 'Host', topicId: topic.id, teamSize: 1, topic: 'Override', names: 'Injected' }, token);
    assert.equal(created.status, 201);
    const credentials = await created.json() as { roomId: string; token: string };
    const view = await server.service.getRoom(credentials);
    assert.equal(view.topic, 'Saved');
    assert.deepEqual(view.candidates.map(c => c.name), ['A', 'B']);
    assert.equal((await request('/api/rooms', { name: 'Legacy', names: 'A', teamSize: 1 })).status, 201);
  } finally { await server.close(); }
});

test('saved topics accept title, candidate count, and candidate name upper boundaries', async () => {
  const repo = new SqliteRoomRepository(':memory:');
  try {
    const topic = await new DraftService(repo).createTopic({ title: 'T'.repeat(100), names: Array.from({ length: 500 }, (_, i) => String(i).padEnd(100, 'x')).join('\n') }, owner());
    assert.equal(topic.candidates.length, 500);
    assert.equal(topic.title.length, 100);
  } finally { repo.close(); }
});

test('Supabase lists all accessible topics across pages including older owned private topics', async () => {
  const token = owner();
  const ownerHash = createHash('sha256').update(token).digest('hex');
  const rows = Array.from({ length: 1002 }, (_, i) => ({
    id: `topic-${String(i).padStart(4, '0')}`, title: `Topic ${i}`, candidates: ['A'],
    is_public: i < 1001, created_at: new Date(2026, 0, 1).toISOString(), owner_hash: i < 1001 ? 'a'.repeat(64) : ownerHash,
  }));
  const offsets: number[] = [];
  const repo = new SupabaseRoomRepository('https://test.supabase.co', 'sb_secret_test', async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('or'), `(is_public.eq.true,owner_hash.eq.${ownerHash})`);
    assert.equal(url.searchParams.get('order'), 'created_at.desc,id.asc');
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 1000), 1000);
    offsets.push(offset);
    return Response.json(rows.slice(offset, offset + limit));
  });
  const topics = await new DraftService(repo).listTopics(token);
  assert.equal(topics.length, 1002);
  assert.equal(topics.at(-1)?.isOwner, true);
  assert.equal(topics.at(-1)?.isPublic, false);
  assert.equal(JSON.stringify(topics).includes(ownerHash), false);
  assert.ok(offsets.length > 1);
});
