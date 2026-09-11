import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createRoom,
  DomainError,
  joinRoom,
  startRoom,
  submitPick,
  toView,
} from './draft.js';
import type { CreateRoomInput, Room } from '../shared/types.js';

function roomInput(candidateNames: readonly string[], teamSize = 1): CreateRoomInput {
  return {
    id: 'room-1',
    host: { id: 'host', name: 'Host', tokenHash: 'host-token-hash' },
    candidates: candidateNames.map((name, index) => ({ id: `candidate-${index + 1}`, name })),
    teamSize,
  };
}

function fixtureRoom(
  candidateNames: readonly string[],
  teamSize = 1,
  guestNames: readonly string[] = ['Guest'],
): Room {
  let room = createRoom(roomInput(candidateNames, teamSize));
  for (const [index, name] of guestNames.entries()) {
    room = joinRoom(room, {
      id: `guest-${index + 1}`,
      name,
      tokenHash: `guest-${index + 1}-token-hash`,
    });
  }
  return room;
}

const key = (round: number, attempt: number) => ({ round, attempt });

describe('room setup', () => {
  test('normalizes each member and candidate name independently', () => {
    const input = roomInput(['  Aki  ', '\tBo\t']);
    input.host.name = '  Host  ';

    const created = createRoom(input);
    const joined = joinRoom(created, {
      id: 'guest-1',
      name: '  Guest  ',
      tokenHash: 'guest-token-hash',
    });

    assert.equal(created.members[0]?.name, 'Host');
    assert.deepEqual(created.candidates.map(({ name }) => name), ['Aki', 'Bo']);
    assert.equal(joined.members[1]?.name, 'Guest');
    assert.equal(created.members.length, 1, 'joining must leave the prior room unchanged');
  });

  test('rejects names duplicated after trimming', () => {
    assert.throws(
      () => createRoom(roomInput(['Aki', ' Aki '])),
      /candidate name.*unique/i,
    );

    const room = fixtureRoom(['A', 'B']);
    assert.throws(
      () => joinRoom(room, { id: 'new-id', name: ' Guest ', tokenHash: 'new-token' }),
      /member name.*unique/i,
    );
  });

  test('enforces setup value limits at the domain boundary', () => {
    assert.throws(() => createRoom(roomInput(['A'], 0)), /team size/i);
    assert.throws(() => createRoom(roomInput(['A'], 1.5)), /team size/i);
    assert.throws(() => createRoom(roomInput(['A'], 51)), /team size/i);
    assert.throws(() => createRoom(roomInput([''])), /candidate name/i);
    assert.throws(() => createRoom(roomInput(['x'.repeat(101)])), /candidate name/i);
    assert.throws(() => createRoom(roomInput(Array.from({ length: 501 }, (_, i) => `C${i}`))), /500/);
    assert.throws(
      () => joinRoom(createRoom(roomInput(['A'])), {
        id: 'guest-1',
        name: 'x'.repeat(31),
        tokenHash: 'token',
      }),
      /member name/i,
    );
  });

  test('allows at most twenty participants', () => {
    let room = createRoom(roomInput(Array.from({ length: 20 }, (_, i) => `C${i + 1}`)));
    for (let index = 1; index < 20; index += 1) {
      room = joinRoom(room, {
        id: `guest-${index}`,
        name: `Guest ${index}`,
        tokenHash: `token-${index}`,
      });
    }

    assert.equal(room.members.length, 20);
    assert.throws(
      () => joinRoom(room, { id: 'guest-20', name: 'Guest 20', tokenHash: 'token-20' }),
      /20/,
    );
  });

  test('blocks starting with fewer than two participants or too few candidates', () => {
    assert.throws(() => startRoom(createRoom(roomInput(['A'])), 'host'), /two members/i);
    assert.throws(() => startRoom(fixtureRoom(['A'], 1), 'host'), /enough candidates/i);
    assert.throws(() => startRoom(fixtureRoom(['A', 'B'], 2), 'host'), /enough candidates/i);
  });

  test('allows only the host to start', () => {
    const room = fixtureRoom(['A', 'B']);
    assert.throws(
      () => startRoom(room, 'guest-1'),
      (error) => error instanceof DomainError && error.code === 'HOST_ONLY',
    );
  });
});

describe('draft submissions', () => {
  test('hides active choices from other members while exposing submission status', () => {
    let room = startRoom(fixtureRoom(['A', 'B']), 'host');
    room = submitPick(room, 'host', 'candidate-1', key(1, 1), () => 0);

    const guestView = toView(room, 'guest-1');
    const hostView = toView(room, 'host');
    assert.equal(guestView.members.find(({ id }) => id === 'host')?.submitted, true);
    assert.equal(guestView.ownSubmission, undefined);
    assert.deepEqual(hostView.ownSubmission, {
      candidateId: 'candidate-1',
      round: 1,
      attempt: 1,
    });
    assert.equal(JSON.stringify(guestView).includes('candidate-1'), true, 'public candidate list remains visible');
    assert.equal(JSON.stringify(guestView).includes('tokenHash'), false);
    assert.equal(JSON.stringify(guestView).includes('host-token-hash'), false);
  });

  test('returns the same room and version for an identical active retry', () => {
    const started = startRoom(fixtureRoom(['A', 'B']), 'host');
    const submitted = submitPick(started, 'host', 'candidate-1', key(1, 1), () => 0);
    const retried = submitPick(submitted, 'host', 'candidate-1', key(1, 1), () => 1);

    assert.strictEqual(retried, submitted);
    assert.equal(retried.version, submitted.version);
  });

  test('rejects changing an accepted submission and rejects an unknown stale key', () => {
    const started = startRoom(fixtureRoom(['A', 'B']), 'host');
    const submitted = submitPick(started, 'host', 'candidate-1', key(1, 1), () => 0);

    assert.throws(
      () => submitPick(submitted, 'host', 'candidate-2', key(1, 1), () => 0),
      /already submitted/i,
    );
    assert.throws(
      () => submitPick(submitted, 'guest-1', 'candidate-2', key(2, 1), () => 0),
      /stale/i,
    );
  });

  test('accepts an identical retry after its attempt was committed without rerolling', () => {
    let room = startRoom(fixtureRoom(['A', 'B']), 'host');
    room = submitPick(room, 'host', 'candidate-1', key(1, 1), () => 0);
    const committed = submitPick(room, 'guest-1', 'candidate-1', key(1, 1), () => 0);
    let lotteryCalled = false;

    const retried = submitPick(committed, 'guest-1', 'candidate-1', key(1, 1), () => {
      lotteryCalled = true;
      return 1;
    });

    assert.strictEqual(retried, committed);
    assert.equal(lotteryCalled, false);
    assert.equal(retried.history.length, 1);
  });

  test('rejects a candidate that was already picked', () => {
    let room = startRoom(fixtureRoom(['A', 'B']), 'host');
    room = submitPick(room, 'host', 'candidate-1', key(1, 1), () => 0);
    room = submitPick(room, 'guest-1', 'candidate-1', key(1, 1), () => 0);

    assert.throws(
      () => submitPick(room, 'guest-1', 'candidate-1', key(1, 2), () => 0),
      /already picked/i,
    );
  });

  test('resolves every group in an attempt atomically', () => {
    let room = startRoom(fixtureRoom(['A', 'B']), 'host');
    room = submitPick(room, 'host', 'candidate-1', key(1, 1), () => 0);
    const beforeResolution = room;
    room = submitPick(room, 'guest-1', 'candidate-2', key(1, 1), () => 0);

    assert.deepEqual(beforeResolution.members.map(({ picks }) => picks), [[], []]);
    assert.deepEqual(room.members.map(({ picks }) => picks), [['candidate-1'], ['candidate-2']]);
    assert.equal(room.status, 'completed');
    assert.deepEqual(room.history, [
      { round: 1, attempt: 1, candidateId: 'candidate-1', memberIds: ['host'], winnerId: 'host' },
      { round: 1, attempt: 1, candidateId: 'candidate-2', memberIds: ['guest-1'], winnerId: 'guest-1' },
    ]);
  });

  test('uses stable participant order for a collision and only the loser re-picks', () => {
    let room = startRoom(fixtureRoom(['A', 'B', 'C'], 1, ['First guest', 'Second guest']), 'host');
    room = submitPick(room, 'host', 'candidate-1', key(1, 1), () => 0);
    room = submitPick(room, 'guest-1', 'candidate-1', key(1, 1), () => 0);
    room = submitPick(room, 'guest-2', 'candidate-2', key(1, 1), (length) => {
      assert.equal(length, 2);
      return 1;
    });

    assert.deepEqual(room.members.map(({ picks }) => picks), [[], ['candidate-1'], ['candidate-2']]);
    assert.equal(room.attempt, 2);
    assert.deepEqual(toView(room, 'host').eligibleMemberIds, ['host']);
    assert.throws(
      () => submitPick(room, 'guest-1', 'candidate-3', key(1, 2), () => 0),
      /not eligible/i,
    );

    room = submitPick(room, 'host', 'candidate-3', key(1, 2), () => 0);
    assert.equal(room.status, 'completed');
  });

  test('rejects an invalid lottery result without changing the room', () => {
    let room = startRoom(fixtureRoom(['A', 'B']), 'host');
    room = submitPick(room, 'host', 'candidate-1', key(1, 1), () => 0);

    assert.throws(
      () => submitPick(room, 'guest-1', 'candidate-1', key(1, 1), () => 2),
      /lottery/i,
    );
    assert.deepEqual(room.members.map(({ picks }) => picks), [[], []]);
    assert.equal(room.history.length, 0);
  });

  test('advances rounds and completes a multi-round draft', () => {
    let room = startRoom(fixtureRoom(['A', 'B', 'C', 'D'], 2), 'host');
    room = submitPick(room, 'host', 'candidate-1', key(1, 1), () => 0);
    room = submitPick(room, 'guest-1', 'candidate-2', key(1, 1), () => 0);
    assert.equal(room.round, 2);
    assert.equal(room.attempt, 1);

    room = submitPick(room, 'host', 'candidate-3', key(2, 1), () => 0);
    room = submitPick(room, 'guest-1', 'candidate-3', key(2, 1), () => 0);
    assert.equal(room.round, 2);
    assert.equal(room.attempt, 2);
    assert.deepEqual(toView(room, 'guest-1').eligibleMemberIds, ['guest-1']);

    room = submitPick(room, 'guest-1', 'candidate-4', key(2, 2), () => 0);
    assert.equal(room.status, 'completed');
    assert.equal(room.round, 2);
    assert.equal(room.attempt, 2);
    assert.deepEqual(room.members.map(({ picks }) => picks), [
      ['candidate-1', 'candidate-3'],
      ['candidate-2', 'candidate-4'],
    ]);
    assert.equal(room.history.length, 4);
  });
});
