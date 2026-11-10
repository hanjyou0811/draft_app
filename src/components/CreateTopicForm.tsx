import { useMemo, useRef, useState, type FormEvent } from 'react';
import type { SavedTopic } from '../../shared/types.js';
import { api, ApiError } from '../api.js';
import { Button } from './ui/Button.js';
import { PublicTopicCopy } from './PublicTopicCopy.js';

export function CreateTopicForm({ onSaved, onUseTopic, onBusyChange }: {
  readonly onSaved: (topic: SavedTopic) => void;
  readonly onUseTopic: (topic: SavedTopic) => void;
  readonly onBusyChange: (busy: boolean) => void;
}) {
  const [title, setTitle] = useState('');
  const [names, setNames] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const namesRef = useRef<HTMLTextAreaElement>(null);
  const [copyNotice, setCopyNotice] = useState('');
  const [saved, setSaved] = useState<SavedTopic>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const candidateCount = useMemo(() => names.split(/\r?\n/u).filter(value => value.trim()).length, [names]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(undefined);
    setBusy(true);
    onBusyChange(true);
    try {
      const topic = await api.createTopic({ title, names, isPublic });
      setSaved(topic);
      onSaved(topic);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'お題を保存できませんでした。');
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  if (saved) return (
    <div className="topic-saved">
      <p className="topic-saved__notice" role="status">お題を保存しました。</p>
      <p className="topic-saved__title">{saved.title}</p>
      <p className="topic-help">候補 {saved.candidates.length}件 · {saved.isPublic ? '公開' : '非公開'}</p>
      <Button onClick={() => onUseTopic(saved)}>このお題でルーム作成</Button>
    </div>
  );

  return (
    <form onSubmit={event => void submit(event)}>
      <fieldset className="creation-fields" disabled={busy}>
        <PublicTopicCopy onCopy={source => {
          setNames(source.candidates.join('\n'));
          setTitle(current => current.trim() ? current : source.title);
          setCopyNotice(`「${source.title}」の候補 ${source.candidates.length}件をコピーしました。`);
          setError(undefined);
          namesRef.current?.focus();
        }} />
        {copyNotice && <p className="topic-copy__notice" role="status">{copyNotice}</p>}
        <label>お題名<input data-initial-focus value={title} onChange={event => setTitle(event.target.value)} placeholder="例：夏に食べたいものドラフト" maxLength={100} required aria-describedby="topic-name-note" /></label>
        <p id="topic-name-note" className="topic-note">お題名は100文字まで。</p>
        <label>候補の名前<textarea ref={namesRef} value={names} onChange={event => setNames(event.target.value)} placeholder={'1行に1つずつ入力\n例：そうめん\nかき氷'} rows={6} required aria-describedby="candidate-count" /></label>
        <p id="candidate-count" className="field-note"><span>候補 {candidateCount}項目</span><span>最大500項目</span></p>
        <div className="topic-visibility">
          <label className="topic-visibility__label"><input type="checkbox" checked={isPublic} onChange={event => setIsPublic(event.target.checked)} aria-describedby="topic-visibility-note" />公開する</label>
          <p id="topic-visibility-note">{isPublic ? 'このアプリを使う全員がお題を選べます。' : '非公開：作成したブラウザだけで選べます。'}</p>
        </div>
        <p className="topic-help">非公開のお題は、このブラウザの保存データを削除すると選べなくなります。</p>
        {error && <p className="alert alert--error" role="alert">{error}</p>}
        <Button disabled={busy} type="submit">{busy ? '保存中…' : 'お題を保存'}</Button>
      </fieldset>
    </form>
  );
}
