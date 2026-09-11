import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import handler from '../api/index.js';

test('Vercel entry handles rewritten paths and pre-parsed JSON without leaking room tokens', async () => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
  const originalFetch = globalThis.fetch;
  let row: unknown;
  globalThis.fetch = async (input, init) => {
    if (!String(input).startsWith('https://test.supabase.co')) return originalFetch(input, init);
    if (init?.method === 'POST') {
      row = JSON.parse(String(init.body));
      return new Response(null, { status: 201 });
    }
    return Response.json(row ? [row] : []);
  };
  const server = createServer((req, res) => {
    if (req.method === 'POST') Object.assign(req, { body: { name: 'Host', names: 'A\nB', teamSize: 1 } });
    void handler(req, res);
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const created = await fetch(`${origin}/api/index?route=rooms`, { method: 'POST' });
    assert.equal(created.status, 201);
    const credentials = await created.json() as { roomId: string; token: string };
    const unauthenticated = await fetch(`${origin}/api/index?route=rooms/${credentials.roomId}`);
    assert.equal(unauthenticated.status, 401);
    const snapshot = await fetch(`${origin}/api/index?route=rooms/${credentials.roomId}`, {
      headers: { authorization: `Bearer ${credentials.token}` },
    });
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.headers.get('cache-control'), 'no-store');
    assert.equal((await snapshot.text()).includes('tokenHash'), false);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
