import { useId, useRef, useState } from 'react';

import type { RoomView } from '../../shared/types.js';
import type { SyncStatus } from '../useRoom.js';
import { RoomHeader } from './RoomHeader.js';

interface WaitingRoomProps {
  readonly room: RoomView;
  readonly syncStatus: SyncStatus;
  readonly busy: boolean;
  readonly onStart: () => void;
}

const tabs = [
  { id: 'participants', label: '参加者' },
  { id: 'candidates', label: '候補リスト' },
  { id: 'invite', label: '招待URL' },
] as const;
type WaitingTab = (typeof tabs)[number]['id'];

export function WaitingRoom({ room, syncStatus, busy, onStart }: WaitingRoomProps) {
  const [activeTab, setActiveTab] = useState<WaitingTab>('participants');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const [copyStatus, setCopyStatus] = useState('');
  const inviteRef = useRef<HTMLInputElement>(null);
  const inviteUrl = location.origin + location.pathname;
  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); setCopyStatus('コピーしました'); }
    catch { inviteRef.current?.focus(); inviteRef.current?.select(); setCopyStatus('URLを選択しました。手動でコピーしてください。'); }
  };
  const own = room.members.find((member) => member.id === room.ownMemberId);
  const required = room.members.length * room.teamSize;
  const shortage = Math.max(0, required - room.candidates.length);
  const ready = room.members.length >= 2 && shortage === 0;


  return (
    <main className="room-workspace waiting-workspace">
      <RoomHeader room={room} syncStatus={syncStatus} />
      <section className="waiting-content" aria-labelledby={`${id}-heading`}>
        <div className="waiting-heading">
          <h1 id={`${id}-heading`}>ドラフト待機室</h1>
          <p>参加者が揃ったら、主催者がドラフトを開始します。</p>
        </div>
        <div className="waiting-tabs" role="tablist" aria-label="待機室の表示">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              ref={(element) => { tabRefs.current[index] = element; }}
              className="waiting-tab"
              type="button"
              role="tab"
              id={`${id}-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`${id}-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => {
                let next: number;
                if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = tabs.length - 1;
                else return;
                event.preventDefault();
                setActiveTab(tabs[next]!.id);
                tabRefs.current[next]?.focus();
              }}
            >{tab.label}{tab.id === 'participants' ? ` ${room.members.length}人` : tab.id === 'candidates' ? ` ${room.candidates.length}件` : ''}</button>
          ))}
        </div>
        <div className="waiting-frame">
          <div className="waiting-panel" role="tabpanel" id={`${id}-panel-${activeTab}`} aria-labelledby={`${id}-tab-${activeTab}`} tabIndex={0}>
            {activeTab === 'participants' && (
              <table className="waiting-members">
                <thead><tr><th scope="col">参加者</th><th scope="col">状態</th></tr></thead>
                <tbody>{room.members.map((member) => (
                  <tr key={member.id} data-own={member.id === room.ownMemberId ? 'true' : undefined}>
                    <td className="waiting-member-name"><strong>{member.name}</strong>{member.id === room.ownMemberId && <span className="waiting-member-badge">あなた</span>}{member.isHost && <span className="waiting-member-badge">主催者</span>}</td>
                    <td><span className="waiting-member-status">参加済み</span></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            {activeTab === 'candidates' && (
              <section aria-label="候補一覧">
                <h2>候補一覧 <span>{room.candidates.length}人</span></h2>
                <ol className="waiting-candidates">{room.candidates.map((candidate, index) => (
                  <li className="waiting-candidate" key={candidate.id}><span>{String(index + 1).padStart(3, '0')}</span><strong>{candidate.name}</strong></li>
                ))}</ol>
              </section>
            )}
            {activeTab === 'invite' && (
              <div className="waiting-invite">
                <h2>仲間を招待</h2><p>招待URLを共有して、参加者を招待できます。</p>
                <label htmlFor="invite-url">招待URL</label>
                <input ref={inviteRef} id="invite-url" value={inviteUrl} readOnly onFocus={event => event.currentTarget.select()} />
                <button className="secondary-button" type="button" onClick={() => void copy()}>URLをコピー</button>
                <p role="status">{copyStatus}</p>
              </div>
            )}
          </div>
        </div>
        <p className="waiting-summary">参加者 {room.members.length}人 · 候補 {room.candidates.length}人 · 各チーム {room.teamSize}人 · 必要数 {required}人</p>
        <footer className="waiting-actions">
          <div className="waiting-readiness" aria-live="polite">
            {room.members.length < 2 && <p>あと1チーム以上の参加を待っています</p>}
            {shortage > 0 && <p>開始には候補があと{shortage}人必要です（必要{required}人／現在{room.candidates.length}人）。</p>}
            {!own?.isHost && <p>主催者の開始を待っています</p>}
            {own?.isHost && ready && <p>参加者が揃ったら開始できます</p>}
            {syncStatus !== 'synced' && <p>接続の復旧を待っています</p>}
          </div>
          <button className="room-primary-button" type="button" onClick={onStart} disabled={!own?.isHost || !ready || syncStatus !== 'synced' || busy}>{busy ? '開始中…' : 'ドラフトを開始'}</button>
        </footer>
      </section>
    </main>
  );
}
