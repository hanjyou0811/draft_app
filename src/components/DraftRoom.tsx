import { useEffect, useMemo, useState } from 'react';

import type { RoomView } from '../../shared/types.js';
import type { SyncStatus } from '../useRoom.js';
import { ConnectionStatus } from './ConnectionStatus.js';
import { History } from './History.js';
import { Teams } from './Teams.js';
import '../draft-stage.css';

interface DraftRoomProps {
  readonly room: RoomView;
  readonly syncStatus: SyncStatus;
  readonly busy: boolean;
  readonly onPick: (candidateId: string) => void;
}

export function DraftRoom({ room, syncStatus, busy, onPick }: DraftRoomProps) {
  const [selected, setSelected] = useState('');
  useEffect(() => setSelected(''), [room.round, room.attempt]);
  const picked = useMemo(() => new Set(room.members.flatMap((member) => member.picks)), [room.members]);
  const own = room.members.find((member) => member.id === room.ownMemberId);
  const eligible = room.eligibleMemberIds.includes(room.ownMemberId);
  const locked = room.ownSubmission !== undefined || !eligible || syncStatus !== 'synced' || busy;
  const latestOwnPickId = own?.picks.at(-1);
  const latestOwnPick = room.candidates.find((candidate) => candidate.id === latestOwnPickId)?.name;

  const completed = room.status === 'completed';
  const displayId = room.ownSubmission?.candidateId ?? (!eligible ? latestOwnPickId : selected);
  const displayName = room.candidates.find((candidate) => candidate.id === displayId)?.name;
  const stageName = completed ? '最高のチームが、決まりました。' : displayName ?? '次の一人を、選ぼう。';

  return (
    <main className="draft-stage">
      <div className="stage-connection"><ConnectionStatus status={syncStatus} /></div>
      <div className="stage-members" aria-label="指名状況">
        {room.members.map((member) => {
          const acquired = completed || !room.eligibleMemberIds.includes(member.id);
          const state = acquired ? '獲得済み' : member.submitted ? '指名済み' : '未指名';
          return (
            <div className={`stage-member ${member.id === room.ownMemberId ? 'stage-member--own' : ''}`} key={member.id}>
              <strong>{member.name}</strong>
              <span aria-hidden="true">{member.id === room.ownMemberId ? 'あなた・' : ''}{state === '未指名' ? '選択中' : state}</span>
              <span className="visually-hidden">{member.name}: {state}</span>
            </div>
          );
        })}
      </div>

      <section className="stage-spotlight" aria-labelledby="stage-title">
        {room.topic && <p className="room-topic stage-topic"><span>お題</span>{room.topic}</p>}
        <h1 id="stage-title">{completed ? 'ドラフト完了' : `第${room.round}巡 選択希望選手`}</h1>
        <p className={`stage-name ${!displayName || completed ? 'stage-name--message' : ''}`} aria-live="polite">{stageName}</p>
        <p className="stage-caption">{own?.name}{completed ? '・チーム編成完了' : room.ownSubmission ? '・指名済み' : !eligible ? '・獲得済み' : '・選択中'}</p>
        {!completed && (
          <>
            <button className="primary-button stage-submit" type="button" disabled={locked || !selected} onClick={() => onPick(selected)}>{busy ? '確認中…' : 'この選手を指名する'}</button>
            <div className="stage-feedback" role="status">
              {syncStatus !== 'synced' ? <p>再接続しています。接続が戻るまでお待ちください。</p>
                : room.ownSubmission ? <p>指名を受け付けました。ほかのチームを待っています。</p>
                : !eligible && latestOwnPick ? <p>{latestOwnPick}を獲得しました</p>
                : room.attempt > 1 && eligible ? <p>抽選の結果、再指名してください（再指名 {room.attempt - 1}回目）</p>
                : <p>{selected ? '確定後は変更できません。' : '下の候補から、獲得したい選手を選んでください。'}</p>}
            </div>
          </>
        )}
      </section>

      {!completed && (
        <section className="stage-candidates" aria-labelledby="pick-title">
          <div className="stage-section-heading">
            <h2 id="pick-title">指名候補</h2>
            {room.history.length > 0 && <a href="#draft-history">指名履歴を見る</a>}
          </div>
          <fieldset disabled={locked}>
            <legend className="visually-hidden">未獲得の候補</legend>
            <div className="stage-candidate-list">
              {room.candidates.map((candidate) => {
                const acquired = picked.has(candidate.id);
                return (
                  <label className={`stage-candidate ${displayId === candidate.id ? 'stage-candidate--selected' : ''} ${acquired ? 'stage-candidate--acquired' : ''}`} key={candidate.id}>
                    <input aria-label={candidate.name} type="radio" name="candidate" value={candidate.id} checked={displayId === candidate.id} disabled={acquired || locked} onChange={() => setSelected(candidate.id)} />
                    <strong>{candidate.name}</strong>
                    {acquired && <span>獲得済み</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </section>
      )}
      <div className="stage-results">
        <Teams room={room} />
        <div id="draft-history"><History room={room} /></div>
      </div>
    </main>
  );
}
