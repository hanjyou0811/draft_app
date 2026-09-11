import type { RoomView } from '../../shared/types.js';

export function Teams({ room }: { readonly room: RoomView }) {
  const candidates = new Map(room.candidates.map((candidate) => [candidate.id, candidate.name]));
  return (
    <section className="panel teams" aria-labelledby="teams-title">
      <div className="section-heading">
        <p className="step-label">TEAMS</p>
        <h2 id="teams-title">チーム編成</h2>
      </div>
      <div className="team-grid">
        {room.members.map((member) => (
          <article className={`team-card ${member.id === room.ownMemberId ? 'team-card--own' : ''}`} key={member.id}>
            <header>
              <h3>{member.name}のチーム</h3>
              {member.isHost && <span className="tag">作成者</span>}
            </header>
            <ol>
              {Array.from({ length: room.teamSize }, (_, index) => {
                const pick = member.picks[index];
                return <li key={index}><span>{index + 1}</span>{pick === undefined ? <em>指名待ち</em> : <strong>{candidates.get(pick)}</strong>}</li>;
              })}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}
