import { useState } from 'react';

import type { RoomView } from '../../shared/types.js';
import type { SyncStatus } from '../useRoom.js';
import { ConnectionStatus } from './ConnectionStatus.js';
import { Teams } from './Teams.js';

interface WaitingRoomProps {
  readonly room: RoomView;
  readonly syncStatus: SyncStatus;
  readonly busy: boolean;
  readonly onStart: () => void;
}

export function WaitingRoom({ room, syncStatus, busy, onStart }: WaitingRoomProps) {
  const [copied, setCopied] = useState(false);
  const own = room.members.find((member) => member.id === room.ownMemberId);
  const inviteUrl = location.href;
  const required = room.members.length * room.teamSize;
  const shortage = Math.max(0, required - room.candidates.length);
  const ready = room.members.length >= 2 && shortage === 0;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      const input = document.querySelector<HTMLInputElement>('#invite-url');
      input?.select();
    }
  };

  return (
    <main className="room-layout">
      <div className="room-titlebar">
        <div><p className="eyebrow">WAITING ROOM</p><h1>ドラフト待機室</h1><p>参加者が揃ったら、作成者が会議を開始します。</p></div>
        <ConnectionStatus status={syncStatus} />
      </div>
      <section className="panel invite-panel">
        <div className="section-heading"><p className="step-label">STEP 02</p><h2>仲間を招待</h2></div>
        <div className="invite-row">
          <label htmlFor="invite-url">招待URL<span className="visually-hidden">（選択してコピーできます）</span></label>
          <input id="invite-url" value={inviteUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
          <button className="secondary-button" onClick={() => void copy()} type="button">{copied ? 'コピーしました' : 'URLをコピー'}</button>
        </div>
      </section>
      <section className="panel candidate-preview-panel" aria-labelledby="candidate-list-title">
        <div className="section-heading"><p className="step-label">PLAYER LIST</p><h2 id="candidate-list-title">候補一覧 <span>{room.candidates.length}人</span></h2></div>
        <ol className="candidate-preview">
          {room.candidates.map((candidate, index) => <li key={candidate.id}><span>{String(index + 1).padStart(3, '0')}</span><strong>{candidate.name}</strong></li>)}
        </ol>
      </section>
      <section className="panel member-panel" aria-labelledby="members-title">
        <div className="section-heading"><p className="step-label">ENTRY</p><h2 id="members-title">参加チーム <span>{room.members.length}/20</span></h2></div>
        <ul className="member-list">
          {room.members.map((member, index) => <li key={member.id}><span className="member-number">{String(index + 1).padStart(2, '0')}</span><strong>{member.name}</strong>{member.isHost && <span className="tag">作成者</span>}{member.id === room.ownMemberId && <span className="you">あなた</span>}</li>)}
        </ul>
        <div className="readiness">
          <div><span>候補</span><strong>{room.candidates.length}人</strong></div>
          <div><span>必要数</span><strong>{required}人</strong></div>
          <div><span>各チーム</span><strong>{room.teamSize}人</strong></div>
        </div>
        {shortage > 0 && <p className="alert alert--warning">開始には候補があと{shortage}人必要です（必要{required}人／現在{room.candidates.length}人）。</p>}
        {room.members.length < 2 && <p className="waiting-note"><span className="pulse" />あと1チーム以上の参加を待っています</p>}
        {own?.isHost ? <button className="primary-button primary-button--wide" type="button" onClick={onStart} disabled={!ready || syncStatus !== 'synced' || busy}>{busy ? '開始中…' : 'ドラフトを開始'}</button> : <p className="waiting-note"><span className="pulse" />作成者の開始を待っています</p>}
      </section>
      <Teams room={room} />
    </main>
  );
}
