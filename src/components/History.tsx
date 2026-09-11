import type { RoomView } from '../../shared/types.js';

export function History({ room }: { readonly room: RoomView }) {
  if (room.history.length === 0) return null;
  const candidates = new Map(room.candidates.map((candidate) => [candidate.id, candidate.name]));
  const members = new Map(room.members.map((member) => [member.id, member.name]));
  return (
    <section className="panel history" aria-labelledby="history-title">
      <div className="section-heading">
        <p className="step-label">RESULT LOG</p>
        <h2 id="history-title">抽選結果</h2>
      </div>
      <ol className="history-list">
        {[...room.history].reverse().map((outcome) => (
          <li key={`${outcome.round}-${outcome.attempt}-${outcome.candidateId}`}>
            <div className="history-round">第{outcome.round}巡{outcome.attempt > 1 ? `・再指名${outcome.attempt - 1}回目` : ''}</div>
            <div><strong>{candidates.get(outcome.candidateId)}</strong><span>{outcome.memberIds.map((id) => members.get(id)).join('・')} が指名</span></div>
            <p><span aria-hidden="true">◆</span> {members.get(outcome.winnerId)} が獲得</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
