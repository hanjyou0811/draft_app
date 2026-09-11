import { useMemo, useState, type FormEvent } from 'react';

import type { Credentials } from '../../shared/types.js';
import { api, ApiError, canPersistCredentials, saveCredentials } from '../api.js';

export function CreateRoom({ onCreated }: {
  readonly onCreated: (credentials: Credentials, persisted: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [names, setNames] = useState('');
  const [teamSize, setTeamSize] = useState('1');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const candidateCount = useMemo(() => names.split(/\r?\n/u).filter((value) => value.trim()).length, [names]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    if (!canPersistCredentials()) {
      setError('このブラウザーでは参加情報を保存できません。ブラウザーの保存設定を確認してください。');
      return;
    }
    setBusy(true);
    try {
      const credentials = await api.createRoom({ name, names, teamSize: Number(teamSize) });
      onCreated(credentials, saveCredentials(credentials));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '会議を作成できませんでした。');
      setBusy(false);
    }
  };

  return (
    <main className="landing">
      <section className="hero">
        <p className="eyebrow">みんなでつくる、最高のチーム</p>
        <h1>指名の瞬間を、<br /><span>みんなの画面に。</span></h1>
        <p className="hero__copy">候補を用意して、招待URLを送るだけ。重複指名の抽選から再指名まで、リアルタイムで進みます。</p>
        <ol className="hero-steps"><li><span>1</span>候補を登録</li><li><span>2</span>URLで招待</li><li><span>3</span>一斉に指名</li></ol>
        <div className="hero-art" aria-hidden="true"><span className="hero-shape">↗</span><span className="hero-shape">✳</span><span className="hero-shape">✓</span></div>
      </section>
      <section className="paper-card create-card" aria-labelledby="create-title">
        <p className="step-label">STEP 01</p>
        <h2 id="create-title">ドラフト会議をつくる</h2>
        <form onSubmit={(event) => void submit(event)}>
          <label>表示名<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例：東京チーム" maxLength={30} required autoComplete="nickname" /></label>
          <label>候補の名前<textarea value={names} onChange={(event) => setNames(event.target.value)} placeholder={'1行に1人ずつ入力\n例：山田 太郎\n　　鈴木 一郎'} rows={7} required /></label>
          <p className="field-note"><span>候補 {candidateCount}人</span><span>最大500人</span></p>
          <label>各チームの獲得人数<input value={teamSize} onChange={(event) => setTeamSize(event.target.value)} type="number" min="1" max="50" required /></label>
          {error && <p className="alert alert--error" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy} type="submit">{busy ? '作成中…' : '会議を作成'}</button>
        </form>
      </section>
    </main>
  );
}
