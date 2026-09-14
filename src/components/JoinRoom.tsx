import { useEffect, useState, type FormEvent } from 'react';

import type { Credentials } from '../../shared/types.js';
import { api, ApiError, canPersistCredentials, saveCredentials, type RoomInfo } from '../api.js';

export function JoinRoom({ roomId, onJoined }: {
  readonly roomId: string;
  readonly onJoined: (credentials: Credentials, persisted: boolean) => void;
}) {
  const [info, setInfo] = useState<RoomInfo>();
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api.getInfo(roomId).then((value) => active && setInfo(value)).catch((cause: unknown) => {
      if (active) setError(cause instanceof ApiError ? cause.message : '会議を確認できませんでした。');
    });
    return () => { active = false; };
  }, [roomId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    if (!canPersistCredentials()) {
      setError('このブラウザーでは参加情報を保存できません。ブラウザーの保存設定を確認してください。');
      return;
    }
    setBusy(true);
    try {
      const credentials = await api.joinRoom(roomId, name);
      onJoined(credentials, saveCredentials(credentials));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '参加できませんでした。');
      setBusy(false);
    }
  };

  if (error && info === undefined) return <main className="center-card"><section className="paper-card"><h1>招待URLを確認</h1><p className="alert alert--error" role="alert">{error}</p><a href="/">新しい会議を作る</a></section></main>;
  if (info === undefined) return <main className="loading" role="status">会議を確認しています…</main>;
  if (info.status !== 'waiting') return <main className="center-card"><section className="paper-card"><h1>この会議は開始済みです</h1><p>この端末には参加情報がありません。参加済みの端末から開いてください。</p><a href="/">新しい会議を作る</a></section></main>;

  return (
    <main className="center-card">
      <section className="paper-card join-card">
        <p className="step-label">INVITATION</p>
        <h1>ドラフト会議に参加</h1>
        {info.topic && <p className="room-topic"><span>お題</span>{info.topic}</p>}
        <p>{info.participantCount}チームが待機中です。あなたのチーム名を入力してください。</p>
        <form onSubmit={(event) => void submit(event)}>
          <label>表示名<input value={name} onChange={(event) => setName(event.target.value)} maxLength={30} required autoComplete="nickname" /></label>
          {error && <p className="alert alert--error" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy} type="submit">{busy ? '参加中…' : '参加する'}</button>
        </form>
      </section>
    </main>
  );
}
