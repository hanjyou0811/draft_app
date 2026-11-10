import { useEffect, useMemo, useRef, useState } from 'react';

import type { RoomView } from '../../shared/types.js';
import type { SyncStatus } from '../useRoom.js';
import { DraftMatrix } from './DraftMatrix.js';
import { RoomHeader } from './RoomHeader.js';
import { History } from './History.js';

interface DraftRoomProps {
  readonly room: RoomView;
  readonly syncStatus: SyncStatus;
  readonly busy: boolean;
  readonly onPick: (candidateId: string) => void;
}

export function DraftRoom({ room, syncStatus, busy, onPick }: DraftRoomProps) {
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const historyDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { setSelected(''); setQuery(''); }, [room.round, room.attempt]);
  const picked = useMemo(() => new Set(room.members.flatMap(member => member.picks)), [room.members]);
  const own = room.members.find(member => member.id === room.ownMemberId);
  const eligible = room.eligibleMemberIds.includes(room.ownMemberId);
  const completed = room.status === 'completed';
  const locked = completed || room.ownSubmission !== undefined || !eligible || syncStatus !== 'synced' || busy;
  const selectedCandidate = room.candidates.find(candidate => candidate.id === (room.ownSubmission?.candidateId ?? (!eligible ? own?.picks.at(-1) : selected)));
  const canSubmit = !locked && !!selectedCandidate && !picked.has(selectedCandidate.id);
  const latestOwnPick = room.candidates.find(candidate => candidate.id === own?.picks.at(-1))?.name;
  const normalizedQuery = query.normalize('NFKC').trim().toLocaleLowerCase('ja');
  const filtered = room.candidates.filter(candidate => candidate.name.normalize('NFKC').toLocaleLowerCase('ja').includes(normalizedQuery));
  const latest = room.history.at(-1);
  const latestOutcomes = latest ? room.history.filter(outcome => outcome.round === latest.round && outcome.attempt === latest.attempt) : [];
  const candidateNames = new Map(room.candidates.map(candidate => [candidate.id, candidate.name]));
  const memberNames = new Map(room.members.map(member => [member.id, member.name]));

  return (
    <main className="room-workspace draft-workspace">
      <RoomHeader room={room} syncStatus={syncStatus} />
      <div className={`draft-content ${completed ? 'draft-content--completed' : ''}`}>
        <section className="draft-board" aria-labelledby="draft-title">
          <div className="draft-board__heading">
            <h1 id="draft-title">{completed ? 'ドラフト完了' : `第${room.round}巡`}</h1>
            {!completed && <p>{room.attempt > 1 ? `再指名${room.attempt - 1}回目` : `参加者 ${room.members.length}人 · 各チーム ${room.teamSize}人`}</p>}
            <button className="room-text-button" type="button" disabled={!latest} onClick={() => historyDialog.current?.showModal()}>履歴を見る</button>
          </div>
          <DraftMatrix room={room} />
          <section className="draft-latest" aria-label="直近の指名結果">
            {latest ? <><h2>抽選結果</h2><p>{latestOutcomes.map(outcome => `${memberNames.get(outcome.winnerId)}：${candidateNames.get(outcome.candidateId)}を獲得`).join(' ／ ')}</p></>
              : <p>全員の指名がそろうと、結果がここに表示されます。</p>}
          </section>
        </section>
        <section className="draft-picker" aria-labelledby="picker-title">
          <h2 id="picker-title">{completed ? 'あなたのチーム' : '候補を選ぶ'}</h2>
          {completed ? <>
            <p className="draft-complete-note">{own?.name} · {own?.picks.length ?? 0}人を獲得</p>
            <ol className="draft-own-picks">{own?.picks.map(id => <li key={id}>{candidateNames.get(id)}</li>)}</ol>
            <p className="draft-complete-note">全チームの結果は左の表で確認できます。</p>
          </> : <>
            <label className="visually-hidden" htmlFor="candidate-search">候補を検索</label>
            <input id="candidate-search" className="draft-search" type="search" placeholder="候補を検索" value={query} onChange={event => setQuery(event.target.value)} />
            <p className="draft-candidate-count">未獲得 {room.candidates.length - picked.size} / {room.candidates.length}件{query && ` · 検索 ${filtered.length}件`}</p>
            <fieldset className="draft-choices" disabled={locked}>
              <legend className="visually-hidden">指名候補</legend>
              <div className="draft-candidate-scroll">
                {filtered.length === 0 && <p className="draft-no-matches">一致する候補はありません。</p>}
                {filtered.map(candidate => {
                  const acquired = picked.has(candidate.id);
                  return <label className={`draft-choice ${selectedCandidate?.id === candidate.id ? 'draft-choice--selected' : ''}`} key={candidate.id}>
                    <input aria-label={candidate.name} type="radio" name="candidate" value={candidate.id} checked={selectedCandidate?.id === candidate.id} disabled={acquired || locked} onChange={() => setSelected(candidate.id)} />
                    <span>{candidate.name}</span>{acquired && <small>獲得済み</small>}
                  </label>;
                })}
              </div>
            </fieldset>
            <div className="draft-pick-action">
              <p className="draft-selection">{room.ownSubmission ? '指名済み' : !eligible ? '獲得済み' : '選択中'}：<strong>{selectedCandidate?.name ?? '未選択'}</strong></p>
              <button className="room-primary-button" type="button" disabled={!canSubmit} onClick={() => { if (canSubmit && selectedCandidate) onPick(selectedCandidate.id); }}>{busy ? '確認中…' : '指名を確定'}</button>
              <p className="draft-feedback" role="status" aria-live="polite">
                {syncStatus !== 'synced' ? '接続が戻るまでお待ちください。'
                  : room.ownSubmission ? '指名を受け付けました。ほかのチームを待っています。'
                    : !eligible && latestOwnPick ? `${latestOwnPick}を獲得しました`
                      : room.attempt > 1 && eligible ? '抽選の結果、再指名してください。'
                        : selectedCandidate ? '確定後は変更できません。' : '候補を選んで指名を確定してください。'}
              </p>
            </div>
          </>}
        </section>
      </div>
      <dialog className="room-history-dialog" ref={historyDialog} aria-label="指名履歴" onClick={event => { if (event.target === event.currentTarget) historyDialog.current?.close(); }}>
        <div className="room-history-content"><button className="room-text-button" type="button" onClick={() => historyDialog.current?.close()}>閉じる</button><History room={room} /></div>
      </dialog>
    </main>
  );
}
