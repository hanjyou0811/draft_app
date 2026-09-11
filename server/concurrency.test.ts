import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DraftService } from './service.js';
import { SqliteRoomRepository } from './sqlite.js';

test('independent servers preserve concurrent joins and picks', async () => {
  const repository = new SqliteRoomRepository(':memory:');
  try {
    const a = new DraftService(repository);
    const b = new DraftService(repository);
    const host = await a.createRoom({ name: 'Host', names: 'A\nB\nC\nD', teamSize: 1 });
    const [guest, third] = await Promise.all([
      a.joinRoom(host.roomId, { name: 'Guest' }),
      b.joinRoom(host.roomId, { name: 'Third' }),
    ]);
    const room = await a.startRoom(host);
    await Promise.all([host, guest, third].map((credentials, i) =>
      (i === 1 ? b : a).submitPick(credentials, {
        candidateId: room.candidates[i]!.id, round: room.round, attempt: room.attempt,
      })));
    const result = await b.getRoom(host);
    assert.equal(result.status, 'completed');
    assert.equal(result.members.length, 3);
  } finally { repository.close(); }
});
