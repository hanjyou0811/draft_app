import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DraftService } from './service.js';
import { SqliteRoomRepository } from './sqlite.js';

test('invitations require a separate key, survive service restart, rotate, and stay private', async () => {
  const repository = new SqliteRoomRepository(':memory:');
  try {
    const service = new DraftService(repository);
    const host = await service.createRoom({ name: 'Host', names: 'A\nB', teamSize: 1 });
    await assert.rejects(service.getInfo(host.roomId), { code: 'INVITATION_REQUIRED' });
    await assert.rejects(service.joinRoom(host.roomId, { name: 'Intruder' }), { code: 'INVITATION_REQUIRED' });
    const first = await service.getInvitation(host);
    const restarted = new DraftService(repository);
    assert.deepEqual(await restarted.getInvitation(host), first);
    const guest = await restarted.joinInvitation(first.inviteKey, { name: 'Guest' });
    await assert.rejects(service.getInvitation(guest), { code: 'INVITATION_HOST_ONLY' });
    await assert.rejects(service.rotateInvitation(guest), { code: 'INVITATION_HOST_ONLY' });
    const second = await restarted.rotateInvitation(host);
    assert.notEqual(first.inviteKey, second.inviteKey);
    for (const key of [first.inviteKey, 'bad', `${host.roomId}.${'0'.repeat(64)}`, `other.${second.inviteKey.split('.').at(-1)}`]) {
      await assert.rejects(service.getInvitationInfo(key), { code: 'INVITATION_NOT_FOUND' });
      await assert.rejects(service.joinInvitation(key, { name: 'Late' }), { code: 'INVITATION_NOT_FOUND' });
    }
    const view = await service.getRoom(guest);
    const info = await service.getInvitationInfo(second.inviteKey);
    const internal = (await repository.get(host.roomId))!.invitation!;
    for (const secret of [internal.nonce, internal.keyHash, second.inviteKey.split('.').at(-1)!]) {
      assert.equal(JSON.stringify({ view, info }).includes(secret), false);
    }
    await service.startRoom(host);
    await assert.rejects(service.getInvitation(host), { code: 'INVITATION_NOT_WAITING' });
    await assert.rejects(service.rotateInvitation(host), { code: 'INVITATION_NOT_WAITING' });
  } finally { repository.close(); }
});

test('legacy aggregates initialize invitations with CAS and survive durable restart', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'invite-recovery-'));
  const path = join(directory, 'rooms.sqlite');
  let repository = new SqliteRoomRepository(path);
  try {
    const service = new DraftService(repository);
    const host = await service.createRoom({ name: 'Host', names: 'A\nB', teamSize: 1 });
    const room = (await repository.get(host.roomId))!;
    const { invitation: _invitation, ...legacy } = room;
    await repository.save({ ...legacy, version: room.version + 1 }, room.version);
    await assert.rejects(service.getInvitationInfo(host.roomId), { code: 'INVITATION_NOT_FOUND' });
    const [one, two] = await Promise.all([service.getInvitation(host), new DraftService(repository).getInvitation(host)]);
    assert.deepEqual(one, two);
    assert.equal((await repository.get(host.roomId))!.version, room.version + 2);
    repository.close();
    repository = new SqliteRoomRepository(path);
    assert.deepEqual(await new DraftService(repository).getInvitation(host), one);
  } finally { repository.close(); await rm(directory, { recursive: true, force: true }); }
});

test('cross-instance rotation wins CAS before a paused join and rejects stale key on retry', async () => {
  const repository = new SqliteRoomRepository(':memory:');
  try {
    const a = new DraftService(repository);
    const b = new DraftService(repository);
    const host = await a.createRoom({ name: 'Host', names: 'A\nB', teamSize: 1 });
    const { inviteKey } = await a.getInvitation(host);
    const save = repository.save.bind(repository);
    let release!: () => void;
    let reached!: () => void;
    const paused = new Promise<void>(resolve => { reached = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    repository.save = async (room, version) => {
      if (room.members.length === 2) { reached(); await resume; }
      return save(room, version);
    };
    const joining = a.joinInvitation(inviteKey, { name: 'Guest' });
    const rejected = assert.rejects(joining, { code: 'INVITATION_NOT_FOUND' });
    await paused;
    const rotated = await b.rotateInvitation(host);
    release();
    await rejected;
    assert.equal((await a.getRoom(host)).members.length, 1);
    const guest = await a.joinInvitation(rotated.inviteKey, { name: 'Guest' });
    await b.rotateInvitation(host);
    assert.equal((await b.getRoom(guest)).members.length, 2);
  } finally { repository.close(); }
});
