import { useMemo, useState, type FormEvent } from 'react';

import type { Credentials } from '../../shared/types.js';
import { api, ApiError, canPersistCredentials, saveCredentials } from '../api.js';
import lotteryImage from '../../baseball_draft_kuji.png';
import resultImage from '../../baseball_draft_kekka.png';
import '../hero-lottery.css';
import { Button } from './ui/Button.js';

export function CreateRoom({ onCreated }: {
  readonly onCreated: (credentials: Credentials, persisted: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [names, setNames] = useState('');
  const [teamSize, setTeamSize] = useState('1');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [lotteryState, setLotteryState] = useState<'idle' | 'drawing' | 'result'>('idle');
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
      const credentials = await api.createRoom({ name, names, topic, teamSize: Number(teamSize) });
      onCreated(credentials, saveCredentials(credentials));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '会議を作成できませんでした。');
      setBusy(false);
    }
  };

  return (
    <main className="landing">
      <section className="hero">
        <img className="hero-logo" src="/hero-logo.svg" alt="DRAFT ROOM" width="600" height="160" />
        <h1 className="visually-hidden">みんなで楽しむドラフト会議</h1>
        <figure className="hero-lottery">
          <button
            type="button"
            className={`hero-lottery__scene hero-lottery__scene--${lotteryState}`}
            aria-label={lotteryState === 'result' ? 'もう一度くじを引く準備をする' : 'くじを引く'}
            aria-disabled={lotteryState === 'drawing'}
            onClick={() => {
              if (lotteryState !== 'drawing') setLotteryState(lotteryState === 'idle' ? 'drawing' : 'idle');
            }}
            onAnimationEnd={(event) => {
              if (event.animationName === 'hero-lottery-result') setLotteryState('result');
            }}
          >
            <img className="hero-lottery__image hero-lottery__image--draw" src={lotteryImage} alt="" width="397" height="400" />
            <img className="hero-lottery__image hero-lottery__image--result" src={resultImage} alt="" width="412" height="450" />
          </button>
        </figure>
        <ol className="hero-steps"><li><span>1</span>候補を登録</li><li><span>2</span>URLで招待</li><li><span>3</span>一斉に指名</li></ol>
      </section>
      <section className="paper-card create-card" aria-labelledby="create-title">
        <p className="step-label">STEP 01</p>
        <h2 id="create-title">ドラフト会議をつくる</h2>
        <form onSubmit={(event) => void submit(event)}>
          <label>お題（任意）<input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="例：夏に食べたいものドラフト" maxLength={100} aria-describedby="topic-note" /></label>
          <p id="topic-note" className="topic-note">空欄でも作成できます。100文字まで。</p>
          <label>表示名<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例：東京チーム" maxLength={30} required autoComplete="nickname" /></label>
          <label>候補の名前<textarea value={names} onChange={(event) => setNames(event.target.value)} placeholder={'1行に1つずつ入力\n例：そうめん\n　　かき氷'} rows={7} required /></label>
          <p className="field-note"><span>候補 {candidateCount}人</span><span>最大500項目</span></p>
          <label>各チームの獲得人数<input value={teamSize} onChange={(event) => setTeamSize(event.target.value)} type="number" min="1" max="50" required /></label>
          {error && <p className="alert alert--error" role="alert">{error}</p>}
          <Button disabled={busy} type="submit">{busy ? '作成中…' : '会議を作成'}</Button>
        </form>
      </section>
    </main>
  );
}
