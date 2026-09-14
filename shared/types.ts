export type RoomStatus = 'waiting' | 'drafting' | 'completed';

export interface RoundKey {
  readonly round: number;
  readonly attempt: number;
}

export interface Candidate {
  readonly id: string;
  readonly name: string;
}

export interface Member {
  readonly id: string;
  readonly name: string;
  readonly isHost: boolean;
  readonly tokenHash: string;
  readonly picks: readonly string[];
}

export interface Submission extends RoundKey {
  readonly memberId: string;
  readonly candidateId: string;
}

export interface Outcome extends RoundKey {
  readonly candidateId: string;
  readonly memberIds: readonly string[];
  readonly winnerId: string;
}

export interface Room {
  readonly topic?: string;
  readonly id: string;
  readonly status: RoomStatus;
  readonly teamSize: number;
  readonly round: number;
  readonly attempt: number;
  readonly version: number;
  readonly candidates: readonly Candidate[];
  readonly members: readonly Member[];
  readonly submissions: readonly Submission[];
  readonly history: readonly Outcome[];
}

export interface CandidateInput {
  id: string;
  name: string;
}

export interface MemberInput {
  id: string;
  name: string;
  tokenHash: string;
}

export interface CreateRoomInput {
  readonly topic?: string;
  id: string;
  host: MemberInput;
  candidates: CandidateInput[];
  teamSize: number;
}

export interface PublicMember {
  readonly id: string;
  readonly name: string;
  readonly isHost: boolean;
  readonly picks: readonly string[];
  readonly submitted: boolean;
}

export interface ActiveSubmission extends RoundKey {
  readonly candidateId: string;
}

export interface RoomView {
  readonly topic?: string;
  readonly id: string;
  readonly status: RoomStatus;
  readonly teamSize: number;
  readonly round: number;
  readonly attempt: number;
  readonly version: number;
  readonly ownMemberId: string;
  readonly candidates: readonly Candidate[];
  readonly members: readonly PublicMember[];
  readonly ownSubmission?: ActiveSubmission;
  readonly eligibleMemberIds: readonly string[];
  readonly history: readonly Outcome[];
}

export interface Credentials {
  readonly roomId: string;
  readonly token: string;
}
