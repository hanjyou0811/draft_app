import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import type { Credentials } from '../../shared/types.js';
import { api, ApiError, canPersistCredentials, saveCredentials } from '../api.js';
import { Button } from './ui/Button.js';

import '../landing.css';

export function CreateRoom({ onCreated }: {
  readonly onCreated: (credentials: Credentials, persisted: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [names, setNames] = useState('');
  const [teamSize, setTeamSize] = useState('1');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'topic' | 'room' | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const topicRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (panel === null) { dialog.close(); return; }
    if (!dialog.open) dialog.showModal();
    (panel === 'topic' ? topicRef : nameRef).current?.focus();
  }, [panel]);
  const candidateCount = useMemo(() => names.split(/\r?\n/u).filter((value) => value.trim()).length, [names]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (panel === 'topic') { setPanel('room'); return; }
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
    <main className="draft-home">
      <section className="draft-home__content" aria-label="ドラフトをはじめる">
        <h1 className="draft-home__title" aria-label="ドラフト">
          <span aria-hidden="true">ド</span><span aria-hidden="true">ラ</span><span aria-hidden="true">フ</span><span aria-hidden="true">ト</span>
        </h1>
        <div className="draft-home__actions">
          <button type="button" className="draft-home__button draft-home__button--topic" onClick={() => setPanel('topic')}>お題作成</button>
          <button type="button" className="draft-home__button draft-home__button--room" onClick={() => setPanel('room')}>ルーム作成</button>
        </div>
      </section>
      <a className="draft-home__github" href="https://github.com/hanjyou0811/draft_app" target="_blank" rel="noopener noreferrer" aria-label="GitHubでソースコードを見る">
        <img src="/icons/github.svg" width="56" height="56" alt="" />
      </a>
      <dialog ref={dialogRef} className="creation-dialog" aria-labelledby="create-title" onCancel={event => { event.preventDefault(); if (!busy) setPanel(null); }} onClick={event => { if (event.target === event.currentTarget && !busy) setPanel(null); }}>
        <div className="creation-dialog__content">
          <button className="creation-dialog__close" type="button" aria-label="閉じる" disabled={busy} onClick={() => setPanel(null)}>×</button>
          <p className="step-label">{panel === 'topic' ? 'まずは、お題から。' : 'みんなで、ドラフト。'}</p>
          <h2 id="create-title">{panel === 'topic' ? 'お題をつくる' : 'ドラフト会議をつくる'}</h2>
        <form onSubmit={(event) => void submit(event)}>
          <label>お題（任意）<input ref={topicRef} value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="例：夏に食べたいものドラフト" maxLength={100} aria-describedby="topic-note" /></label>
          <p id="topic-note" className="topic-note">空欄でも作成できます。100文字まで。</p>
          {panel === 'room' && <label>表示名<input ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} placeholder="例：東京チーム" maxLength={30} required autoComplete="nickname" /></label>}
          <label>候補の名前<textarea value={names} onChange={(event) => setNames(event.target.value)} placeholder={'1行に1つずつ入力\n例：そうめん\n　　かき氷'} rows={7} required /></label>
          <p className="field-note"><span>候補 {candidateCount}項目</span><span>最大500項目</span></p>
          {panel === 'room' && <label>各チームの獲得人数<input value={teamSize} onChange={(event) => setTeamSize(event.target.value)} type="number" min="1" max="50" required /></label>}
          {error && <p className="alert alert--error" role="alert">{error}</p>}
          <Button disabled={busy} type="submit">{panel === 'topic' ? 'このお題でルーム作成' : busy ? '作成中…' : '会議を作成'}</Button>
        </form>
        </div>
      </dialog>
    </main>
  );
}
