import { DomainError, type DomainErrorCode } from '../domain/draft.js';
import { ServiceError } from './service.js';

export interface PublicError {
  readonly status: number;
  readonly message: string;
}

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = 'RequestError';
  }
}

const domainErrors: Record<DomainErrorCode, PublicError> = {
  INVALID_ROOM_ID: { status: 400, message: '会議IDが正しくありません。' },
  INVALID_MEMBER_ID: { status: 400, message: '参加者IDが正しくありません。' },
  INVALID_TOKEN_HASH: { status: 400, message: '認証情報が正しくありません。' },
  INVALID_TOPIC: { status: 400, message: 'お題は100文字以内で入力してください。' },
  INVALID_MEMBER_NAME: { status: 400, message: '表示名を1〜30文字で入力してください。' },
  DUPLICATE_MEMBER_ID: { status: 409, message: '参加者IDが重複しています。' },
  DUPLICATE_MEMBER_NAME: { status: 409, message: '同じ表示名の参加者がいます。' },
  TOO_MANY_MEMBERS: { status: 409, message: '参加者は20人までです。' },
  INVALID_CANDIDATE_ID: { status: 400, message: '候補IDが正しくありません。' },
  INVALID_CANDIDATE_NAME: { status: 400, message: '候補名を1〜100文字で入力してください。' },
  DUPLICATE_CANDIDATE_ID: { status: 409, message: '候補IDが重複しています。' },
  DUPLICATE_CANDIDATE_NAME: { status: 409, message: '同じ候補名があります。' },
  TOO_MANY_CANDIDATES: { status: 400, message: '候補は500件までです。' },
  INVALID_TEAM_SIZE: { status: 400, message: '獲得人数は1〜50の整数で指定してください。' },
  ROOM_NOT_WAITING: { status: 409, message: 'この会議はすでに開始されています。' },
  ROOM_NOT_DRAFTING: { status: 409, message: '現在は指名を受け付けていません。' },
  MEMBER_NOT_FOUND: { status: 401, message: '認証情報が正しくありません。' },
  HOST_ONLY: { status: 400, message: '開始できるのは作成者だけです。' },
  TOO_FEW_MEMBERS: { status: 400, message: '開始するには2人以上必要です。' },
  NOT_ENOUGH_CANDIDATES: { status: 400, message: '全チーム分の候補が足りません。' },
  NOT_ELIGIBLE: { status: 409, message: 'この回の指名対象ではありません。' },
  INVALID_ROUND_KEY: { status: 400, message: '巡と再指名回数が正しくありません。' },
  STALE_ROUND: { status: 409, message: '指名対象の回が更新されています。' },
  ALREADY_SUBMITTED: { status: 409, message: 'この回の指名はすでに確定しています。' },
  CANDIDATE_NOT_FOUND: { status: 400, message: '候補が見つかりません。' },
  CANDIDATE_ALREADY_PICKED: { status: 409, message: 'この候補はすでに獲得されています。' },
  INVALID_LOTTERY_RESULT: { status: 500, message: '抽選を完了できませんでした。' },
};

export function toPublicError(error: unknown): PublicError | undefined {
  if (error instanceof RequestError) {
    return { status: error.status, message: error.publicMessage };
  }
  if (error instanceof ServiceError) {
    return error.code === 'ROOM_NOT_FOUND'
      ? { status: 404, message: '会議が見つかりません。' }
      : { status: 401, message: '認証情報が正しくありません。' };
  }
  if (error instanceof DomainError) return domainErrors[error.code];
  return undefined;
}
