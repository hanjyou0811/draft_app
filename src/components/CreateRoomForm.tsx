import { useEffect, useState, type FormEvent } from 'react';
import type { Credentials, SavedTopic } from '../../shared/types.js';
import { api, ApiError, canPersistCredentials, saveCredentials } from '../api.js';
import { Button } from './ui/Button.js';

export function CreateRoomForm({ initialTopicId, onCreateTopic, onCreated, onBusyChange }: {
  readonly initialTopicId: string;
  readonly onCreateTopic: () => void;
  readonly onCreated: (credentials: Credentials, persisted: boolean) => void;
  readonly onBusyChange: (busy: boolean) => void;
}) {
  const [topics, setTopics] = useState<readonly SavedTopic[]>([]);
  const [topicId, setTopicId] = useState(initialTopicId);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [name, setName] = useState('');
  const [teamSize, setTeamSize] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const selectedTopic = topics.find(topic => topic.id === topicId);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(undefined);
    void api.listTopics().then(savedTopics => {
      if (!active) return;
      setTopics(savedTopics);
      setTopicId(current => savedTopics.some(topic => topic.id === current) ? current : '');
    }).catch(cause => {
      if (active) setLoadError(cause instanceof ApiError ? cause.message : 'お題を取得できませんでした。');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || loading || loadError || !selectedTopic) return;
    setError(undefined);
    if (!canPersistCredentials()) {
      setError('このブラウザーでは参加情報を保存できません。ブラウザーの保存設定を確認してください。');
      return;
    }
    setBusy(true);
    onBusyChange(true);
    try {
      const credentials = await api.createRoom({ name, topicId: selectedTopic.id, teamSize: Number(teamSize) });
      onCreated(credentials, saveCredentials(credentials));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '会議を作成できませんでした。');
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <form onSubmit={event => void submit(event)}>
      <fieldset className="creation-fields" disabled={busy}>
        <label>お題を選択<select value={topicId} onChange={event => setTopicId(event.target.value)} required disabled={loading || !!loadError || topics.length === 0} aria-describedby="topic-list-note">
          <option value="">{loading ? '読み込み中…' : 'お題を選んでください'}</option>
          {topics.map(topic => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
        </select></label>
        <div id="topic-list-note">
          {loading ? <p className="topic-help" role="status">保存済みのお題を読み込んでいます…</p>
            : loadError ? <div className="topic-list-message"><p className="alert alert--error" role="alert">{loadError}</p><button type="button" className="topic-text-button" onClick={() => setRefresh(value => value + 1)}>再読み込み</button></div>
            : topics.length === 0 ? <div className="topic-list-message"><p>選べるお題がまだありません。</p><button type="button" className="topic-text-button" onClick={onCreateTopic}>お題を作成する</button></div>
            : <p className="topic-help">公開のお題と、このブラウザで作成した非公開のお題を選べます。</p>}
        </div>
        {selectedTopic && !loading && !loadError && <section className="saved-topic-preview" aria-label="選択中のお題の候補">
          <div className="saved-topic-preview__heading"><strong>候補 {selectedTopic.candidates.length}件</strong><span>{selectedTopic.isPublic ? '公開' : '非公開'}</span></div>
          <div className="saved-topic-preview__table"><table><caption className="visually-hidden">{selectedTopic.title}の候補</caption><thead><tr><th scope="col">No.</th><th scope="col">候補</th></tr></thead><tbody>{selectedTopic.candidates.map((candidate, index) => <tr key={index}><td>{index + 1}</td><td>{candidate}</td></tr>)}</tbody></table></div>
        </section>}
        <label>表示名<input data-initial-focus value={name} onChange={event => setName(event.target.value)} placeholder="例：東京チーム" maxLength={30} required autoComplete="nickname" /></label>
        <label>各チームの獲得人数<input value={teamSize} onChange={event => setTeamSize(event.target.value)} type="number" min="1" max="50" required /></label>
        <p className="topic-help">参加人数 × 獲得人数以上の候補が必要です。</p>
        {error && <p className="alert alert--error" role="alert">{error}</p>}
        <Button disabled={busy || loading || !!loadError || !selectedTopic} type="submit">{busy ? '作成中…' : '会議を作成'}</Button>
      </fieldset>
    </form>
  );
}
