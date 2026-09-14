import type {
  ActiveSubmission,
  Candidate,
  CreateRoomInput,
  Member,
  MemberInput,
  Outcome,
  Room,
  RoomView,
  RoundKey,
  Submission,
} from '../shared/types.js';

export type DomainErrorCode =
  | 'INVALID_ROOM_ID'
  | 'INVALID_TOPIC'
  | 'INVALID_MEMBER_ID'
  | 'INVALID_TOKEN_HASH'
  | 'INVALID_MEMBER_NAME'
  | 'DUPLICATE_MEMBER_ID'
  | 'DUPLICATE_MEMBER_NAME'
  | 'TOO_MANY_MEMBERS'
  | 'INVALID_CANDIDATE_ID'
  | 'INVALID_CANDIDATE_NAME'
  | 'DUPLICATE_CANDIDATE_ID'
  | 'DUPLICATE_CANDIDATE_NAME'
  | 'TOO_MANY_CANDIDATES'
  | 'INVALID_TEAM_SIZE'
  | 'ROOM_NOT_WAITING'
  | 'ROOM_NOT_DRAFTING'
  | 'MEMBER_NOT_FOUND'
  | 'HOST_ONLY'
  | 'TOO_FEW_MEMBERS'
  | 'NOT_ENOUGH_CANDIDATES'
  | 'NOT_ELIGIBLE'
  | 'INVALID_ROUND_KEY'
  | 'STALE_ROUND'
  | 'ALREADY_SUBMITTED'
  | 'CANDIDATE_NOT_FOUND'
  | 'CANDIDATE_ALREADY_PICKED'
  | 'INVALID_LOTTERY_RESULT';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

function fail(code: DomainErrorCode, message: string): never {
  throw new DomainError(code, message);
}

function normalizedText(
  value: string,
  code: DomainErrorCode,
  label: string,
  maximumLength?: number,
): string {
  if (typeof value !== 'string') {
    return fail(code, `${label} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || (maximumLength !== undefined && normalized.length > maximumLength)) {
    return fail(
      code,
      `${label} must be between 1 and ${maximumLength ?? 'more'} characters`,
    );
  }
  return normalized;
}

function unique(values: readonly string[], code: DomainErrorCode, label: string): void {
  if (new Set(values).size !== values.length) {
    fail(code, `${label} must be unique`);
  }
}

function validatedMember(input: MemberInput, isHost: boolean): Member {
  return {
    id: normalizedText(input.id, 'INVALID_MEMBER_ID', 'member id'),
    name: normalizedText(input.name, 'INVALID_MEMBER_NAME', 'member name', 30),
    isHost,
    tokenHash: normalizedText(input.tokenHash, 'INVALID_TOKEN_HASH', 'token hash'),
    picks: [],
  };
}

function validateRoundKey(roundKey: RoundKey): void {
  if (
    typeof roundKey !== 'object'
    || roundKey === null
    || !Number.isInteger(roundKey.round)
    || roundKey.round < 1
    || !Number.isInteger(roundKey.attempt)
    || roundKey.attempt < 1
  ) {
    fail('INVALID_ROUND_KEY', 'round and attempt must be positive integers');
  }
}

function isSameKey(value: RoundKey, roundKey: RoundKey): boolean {
  return value.round === roundKey.round && value.attempt === roundKey.attempt;
}

function eligibleMemberIds(room: Room): string[] {
  if (room.status !== 'drafting') return [];
  return room.members
    .filter(({ picks }) => picks.length < room.round)
    .map(({ id }) => id);
}

function recordedCandidateId(room: Room, memberId: string, roundKey: RoundKey): string | undefined {
  const active = room.submissions.find(
    (submission) => submission.memberId === memberId && isSameKey(submission, roundKey),
  );
  if (active) return active.candidateId;

  return room.history.find(
    (outcome) => isSameKey(outcome, roundKey) && outcome.memberIds.includes(memberId),
  )?.candidateId;
}

export function createRoom(input: CreateRoomInput): Room {
  if (input.topic !== undefined && (typeof input.topic !== 'string' || input.topic.trim().length > 100)) {
    fail('INVALID_TOPIC', 'topic must be a string of at most 100 characters');
  }
  const topic = input.topic?.trim();
  const id = normalizedText(input.id, 'INVALID_ROOM_ID', 'room id');
  if (!Number.isInteger(input.teamSize) || input.teamSize < 1 || input.teamSize > 50) {
    fail('INVALID_TEAM_SIZE', 'team size must be an integer between 1 and 50');
  }
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    fail('INVALID_CANDIDATE_NAME', 'at least one candidate name is required');
  }
  if (input.candidates.length > 500) {
    fail('TOO_MANY_CANDIDATES', 'candidate count must not exceed 500');
  }

  const candidates: Candidate[] = input.candidates.map((candidate) => ({
    id: normalizedText(candidate.id, 'INVALID_CANDIDATE_ID', 'candidate id'),
    name: normalizedText(candidate.name, 'INVALID_CANDIDATE_NAME', 'candidate name', 100),
  }));
  unique(candidates.map(({ id: candidateId }) => candidateId), 'DUPLICATE_CANDIDATE_ID', 'candidate id');
  unique(candidates.map(({ name }) => name), 'DUPLICATE_CANDIDATE_NAME', 'candidate name');

  return {
    id,
    status: 'waiting',
    ...(topic ? { topic } : {}),
    teamSize: input.teamSize,
    round: 1,
    attempt: 1,
    version: 1,
    candidates,
    members: [validatedMember(input.host, true)],
    submissions: [],
    history: [],
  };
}

export function joinRoom(room: Room, input: MemberInput): Room {
  if (room.status !== 'waiting') {
    fail('ROOM_NOT_WAITING', 'room is not waiting for members');
  }
  if (room.members.length >= 20) {
    fail('TOO_MANY_MEMBERS', 'member count must not exceed 20');
  }

  const member = validatedMember(input, false);
  if (room.members.some(({ id }) => id === member.id)) {
    fail('DUPLICATE_MEMBER_ID', 'member id must be unique');
  }
  if (room.members.some(({ name }) => name === member.name)) {
    fail('DUPLICATE_MEMBER_NAME', 'member name must be unique');
  }

  return {
    ...room,
    version: room.version + 1,
    members: [...room.members, member],
  };
}

export function startRoom(room: Room, memberId: string): Room {
  if (room.status !== 'waiting') {
    fail('ROOM_NOT_WAITING', 'room is not waiting to start');
  }
  const member = room.members.find(({ id }) => id === memberId);
  if (!member) {
    fail('MEMBER_NOT_FOUND', 'member was not found');
  }
  if (!member.isHost) {
    fail('HOST_ONLY', 'only the host can start the room');
  }
  if (room.members.length < 2) {
    fail('TOO_FEW_MEMBERS', 'at least two members are required');
  }
  if (room.members.length > 20) {
    fail('TOO_MANY_MEMBERS', 'member count must not exceed 20');
  }
  if (room.candidates.length < room.members.length * room.teamSize) {
    fail('NOT_ENOUGH_CANDIDATES', 'there are not enough candidates for every team');
  }

  return {
    ...room,
    status: 'drafting',
    version: room.version + 1,
    round: 1,
    attempt: 1,
    submissions: [],
    history: [],
  };
}

export function submitPick(
  room: Room,
  memberId: string,
  candidateId: string,
  roundKey: RoundKey,
  chooseIndex: (length: number) => number,
): Room {
  validateRoundKey(roundKey);
  if (!room.members.some(({ id }) => id === memberId)) {
    fail('MEMBER_NOT_FOUND', 'member was not found');
  }

  const recorded = recordedCandidateId(room, memberId, roundKey);
  if (recorded !== undefined) {
    if (recorded === candidateId) return room;
    fail('ALREADY_SUBMITTED', 'member already submitted a different candidate for this attempt');
  }

  if (room.status !== 'drafting') {
    fail('ROOM_NOT_DRAFTING', 'room is not accepting draft submissions');
  }
  if (room.round !== roundKey.round || room.attempt !== roundKey.attempt) {
    fail('STALE_ROUND', 'submission uses a stale or unknown round key');
  }

  const eligibleIds = eligibleMemberIds(room);
  if (!eligibleIds.includes(memberId)) {
    fail('NOT_ELIGIBLE', 'member is not eligible in this attempt');
  }
  if (!room.candidates.some(({ id }) => id === candidateId)) {
    fail('CANDIDATE_NOT_FOUND', 'candidate was not found');
  }
  if (room.members.some(({ picks }) => picks.includes(candidateId))) {
    fail('CANDIDATE_ALREADY_PICKED', 'candidate was already picked');
  }
  if (typeof chooseIndex !== 'function') {
    fail('INVALID_LOTTERY_RESULT', 'lottery source must be a function');
  }

  const submission: Submission = { memberId, candidateId, ...roundKey };
  const submissions = [...room.submissions, submission];
  const allSubmitted = eligibleIds.every((eligibleId) =>
    submissions.some(
      (item) => item.memberId === eligibleId && isSameKey(item, roundKey),
    ));

  if (!allSubmitted) {
    return { ...room, version: room.version + 1, submissions };
  }

  const groups = new Map<string, string[]>();
  for (const eligibleId of eligibleIds) {
    const memberSubmission = submissions.find(
      (item) => item.memberId === eligibleId && isSameKey(item, roundKey),
    );
    if (!memberSubmission) {
      throw new Error('draft invariant violated: eligible member has no submission');
    }
    const memberIds = groups.get(memberSubmission.candidateId);
    if (memberIds) memberIds.push(eligibleId);
    else groups.set(memberSubmission.candidateId, [eligibleId]);
  }

  const outcomes: Outcome[] = [...groups].map(([groupCandidateId, memberIds]) => {
    let winnerIndex = 0;
    if (memberIds.length > 1) {
      winnerIndex = chooseIndex(memberIds.length);
      if (!Number.isInteger(winnerIndex) || winnerIndex < 0 || winnerIndex >= memberIds.length) {
        fail('INVALID_LOTTERY_RESULT', 'lottery must return an in-range integer index');
      }
    }
    const winnerId = memberIds[winnerIndex];
    if (winnerId === undefined) {
      throw new Error('draft invariant violated: outcome has no winner');
    }
    return {
      ...roundKey,
      candidateId: groupCandidateId,
      memberIds: [...memberIds],
      winnerId,
    };
  });

  const wonCandidateByMember = new Map(outcomes.map(({ winnerId, candidateId: wonId }) => [winnerId, wonId]));
  const members = room.members.map((member) => {
    const wonCandidateId = wonCandidateByMember.get(member.id);
    return wonCandidateId === undefined
      ? member
      : { ...member, picks: [...member.picks, wonCandidateId] };
  });
  const roundComplete = members.every(({ picks }) => picks.length >= room.round);
  const completed = members.every(({ picks }) => picks.length >= room.teamSize);

  return {
    ...room,
    status: completed ? 'completed' : 'drafting',
    round: roundComplete && !completed ? room.round + 1 : room.round,
    attempt: completed ? room.attempt : roundComplete ? 1 : room.attempt + 1,
    version: room.version + 1,
    members,
    submissions: [],
    history: [...room.history, ...outcomes],
  };
}

export function toView(room: Room, ownMemberId: string): RoomView {
  if (!room.members.some(({ id }) => id === ownMemberId)) {
    fail('MEMBER_NOT_FOUND', 'member was not found');
  }

  const active = room.submissions.find(
    (submission) => submission.memberId === ownMemberId
      && submission.round === room.round
      && submission.attempt === room.attempt,
  );
  const ownSubmission: ActiveSubmission | undefined = active
    ? { candidateId: active.candidateId, round: active.round, attempt: active.attempt }
    : undefined;
  const view: RoomView = {
    id: room.id,
    ...(room.topic ? { topic: room.topic } : {}),
    status: room.status,
    teamSize: room.teamSize,
    round: room.round,
    attempt: room.attempt,
    version: room.version,
    ownMemberId,
    candidates: room.candidates.map((candidate) => ({ ...candidate })),
    members: room.members.map((member) => ({
      id: member.id,
      name: member.name,
      isHost: member.isHost,
      picks: [...member.picks],
      submitted: room.submissions.some(
        (submission) => submission.memberId === member.id
          && submission.round === room.round
          && submission.attempt === room.attempt,
      ),
    })),
    eligibleMemberIds: eligibleMemberIds(room),
    history: room.history.map((outcome) => ({
      ...outcome,
      memberIds: [...outcome.memberIds],
    })),
  };
  return ownSubmission === undefined ? view : { ...view, ownSubmission };
}
