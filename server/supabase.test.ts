import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SupabaseRoomRepository } from './supabase.js';
import { RepositoryConflictError } from './repository.js';
import { DraftService } from './service.js';

test('Supabase repository stores and reads rooms and refuses stale writes', async () => {
  let row: any;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(new Headers(init?.headers).get('apikey'), 'sb_secret_test');
    if (init?.method === 'POST') {
      if (row) return Response.json({ code: '23505' }, { status: 409 });
      row = JSON.parse(String(init.body));
      return new Response(null, { status: 201 });
    }
    if (init?.method === 'PATCH') {
      if (`eq.${row.version}` !== url.searchParams.get('version')) return Response.json([]);
      row = JSON.parse(String(init.body));
      return Response.json([{ id: row.id }]);
    }
    return Response.json(row ? [row] : []);
  };
  const repo = new SupabaseRoomRepository('https://test.supabase.co', 'sb_secret_test', fetcher);
  assert.equal(await repo.get('missing'), undefined);
  const service = new DraftService(repo);
  const credentials = await service.createRoom({ name: 'Host', names: 'A\nB', teamSize: 1 });
  const original = (await repo.get(credentials.roomId))!;
  assert.equal(original.members[0]?.name, 'Host');
  await assert.rejects(repo.create(original), RepositoryConflictError);
  await repo.save({ ...original, version: original.version + 1 }, original.version);
  await assert.rejects(repo.save(original, original.version), RepositoryConflictError);
});

test('database errors do not expose credentials or response body', async () => {
  const repo = new SupabaseRoomRepository('https://test.supabase.co', 'sb_secret_test', async () =>
    new Response('private database detail', { status: 500 }));
  await assert.rejects(repo.get('id'), (error: Error) => {
    assert.equal(error.message, 'Supabase request failed (500)');
    return true;
  });
});
