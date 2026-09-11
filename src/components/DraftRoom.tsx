import { useEffect, useMemo, useState } from 'react';

import type { RoomView } from '../../shared/types.js';
import type { SyncStatus } from '../useRoom.js';
import { ConnectionStatus } from './ConnectionStatus.js';
import { History } from './History.js';
import { Teams } from './Teams.js';

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

  return (
    <main className="room-layout">
      <div className="room-titlebar draft-titlebar">
        <div><p className="eyebrow">ROUND {String(room.round).padStart(2, '0')}</p><h1>{room.status === 'completed' ? 'ドラフト完了' : `第${room.round}巡 選択希望選手`}</h1><p>{room.status === 'completed' ? 'すべてのチーム編成が決まりました。' : room.attempt === 1 ? '獲得したい候補を1人選んでください。' : `再指名 ${room.attempt - 1}回目`}</p></div>
        <ConnectionStatus status={syncStatus} />
      </div>

      {room.status !== 'completed' && (
        <section className="panel pick-panel" aria-labelledby="pick-title">
          <div className="section-heading"><p className="step-label">YOUR PICK</p><h2 id="pick-title">指名候補</h2></div>
          {room.attempt > 1 && eligible && <p className="alert alert--repick" role="status">抽選の結果、再指名してください</p>}
          {!eligible && latestOwnPick && <p className="alert alert--success" role="status">{latestOwnPick}を獲得しました</p>}
          {room.ownSubmission && <p className="alert alert--success" role="status">指名を受け付けました。ほかのチームを待っています。</p>}
          <fieldset disabled={locked}>
            <legend className="visually-hidden">未獲得の候補</legend>
            <div className="candidate-grid">
              {room.candidates.map((candidate, index) => {
                const acquired = picked.has(candidate.id);
                return (
                  <label className={`candidate ${selected === candidate.id ? 'candidate--selected' : ''} ${acquired ? 'candidate--acquired' : ''}`} key={candidate.id}>
                    <input aria-label={candidate.name} type="radio" name="candidate" value={candidate.id} checked={selected === candidate.id} disabled={acquired || locked} onChange={() => setSelected(candidate.id)} />
                    <span className="candidate__number">{String(index + 1).padStart(2, '0')}</span>
                    <strong>{candidate.name}</strong>
                    <span className="candidate__state">{acquired ? '獲得済み' : selected === candidate.id ? '選択中' : '選択'}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <button className="primary-button primary-button--wide" type="button" disabled={locked || !selected} onClick={() => onPick(selected)}>{busy ? '確認中…' : 'この選手を指名する'}</button>
          <div className="submission-state" aria-label="指名状況">
            {room.members.map((member) => {
              const acquired = !room.eligibleMemberIds.includes(member.id);
              return <span key={member.id} className={member.submitted || acquired ? 'done' : ''}><i aria-hidden="true" />{member.name}: {acquired ? '獲得済み' : member.submitted ? '指名済み' : '未指名'}</span>;
            })}
          </div>
        </section>
      )}
      <Teams room={room} />
      <History room={room} />
    </main>
  );
}
