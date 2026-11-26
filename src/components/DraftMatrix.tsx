import { useLayoutEffect, useRef } from 'react';
import type { RoomView } from '../../shared/types.js';

export function DraftMatrix({ room }: { readonly room: RoomView }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const row = scroll?.querySelector<HTMLTableRowElement>('tr[aria-current="step"]');
    if (!scroll || !row) return;
    const frame = scroll.getBoundingClientRect();
    const headerHeight = scroll.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    const visibleTop = frame.top + headerHeight + 2;
    const bounds = row.getBoundingClientRect();
    if (bounds.top < visibleTop || bounds.bottom > frame.bottom - 2) scroll.scrollTop += bounds.top - visibleTop;
  }, [room.round, room.status]);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const ownHeader = scroll?.querySelector<HTMLTableCellElement>('thead th[data-own="true"]');
    if (!scroll || !ownHeader) return;
    const frame = scroll.getBoundingClientRect();
    const cornerWidth = scroll.querySelector('.draft-matrix__corner')?.getBoundingClientRect().width ?? 80;
    const bounds = ownHeader.getBoundingClientRect();
    if (bounds.left < frame.left + cornerWidth || bounds.right > frame.right) scroll.scrollLeft += bounds.left - frame.left - cornerWidth - 2;
  }, [room.ownMemberId]);
  const candidateNames = new Map(room.candidates.map(candidate => [candidate.id, candidate.name]));
  return (
    <div ref={scrollRef} className="draft-matrix-scroll" role="region" aria-label="ドラフト結果の表" tabIndex={0}>
      <table className="draft-matrix" aria-label="ドラフト結果" style={{ minWidth: `${80 + room.members.length * 150}px` }}>
        <thead><tr><th scope="col" className="draft-matrix__corner">巡</th>{room.members.map(member => (
          <th key={member.id} scope="col" data-own={member.id === room.ownMemberId ? 'true' : undefined} aria-label={`${member.name}のチーム`}>
            <strong>{member.name}</strong>{member.id === room.ownMemberId && <span className="matrix-own-label">あなた</span>}
          </th>
        ))}</tr></thead>
        <tbody>{Array.from({ length: room.teamSize }, (_, index) => {
          const round = index + 1;
          const current = room.status === 'drafting' && room.round === round;
          return <tr key={round} aria-current={current ? 'step' : undefined}>
            <th scope="row">第{round}巡</th>
            {room.members.map(member => {
              const candidateId = member.picks[index];
              const own = member.id === room.ownMemberId;
              const status = current ? member.submitted ? '指名済み' : own && room.attempt > 1 ? '再指名待ち' : '選択中' : '—';
              return <td key={member.id} data-own={own ? 'true' : undefined}>
                {candidateId ? <><strong>{candidateNames.get(candidateId)}</strong>{current && <small>獲得済み</small>}</>
                  : <span className={own && current ? 'matrix-own-status' : 'matrix-pending'}>{status}</span>}
                {current && <span className="visually-hidden">{member.name}: {candidateId ? '獲得済み' : member.submitted ? '指名済み' : '未指名'}</span>}
              </td>;
            })}
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}
