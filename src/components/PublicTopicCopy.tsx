import { useEffect, useState } from 'react';
import type { SavedTopic } from '../../shared/types.js';
import { api, ApiError } from '../api.js';
import { Button } from './ui/Button.js';

export function PublicTopicCopy({ onCopy }: { readonly onCopy: (source: SavedTopic) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [topics, setTopics] = useState<readonly SavedTopic[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const source = topics.find(topic => topic.id === sourceId);

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    void api.listTopics().then(savedTopics => {
      if (!active) return;
      const publicTopics = savedTopics.filter(topic => topic.isPublic);
      setTopics(publicTopics);
      setSourceId(current => publicTopics.some(topic => topic.id === current) ? current : '');
    }).catch(cause => {
      if (active) setError(cause instanceof ApiError ? cause.message : '公開のお題を読み込めませんでした。');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [expanded, refresh]);

  return (
    <section className="topic-copy" aria-label="公開のお題から候補をコピー">
      <button type="button" className="topic-text-button" aria-expanded={expanded} aria-controls="topic-copy-picker" onClick={() => setExpanded(value => !value)}>公開のお題からコピー</button>
      {expanded && <div id="topic-copy-picker" className="topic-copy__picker">
        {loading ? <p className="topic-help" role="status">公開のお題を読み込んでいます…</p>
          : error ? <div className="topic-list-message"><p className="alert alert--error" role="alert">{error}</p><button type="button" className="topic-text-button" onClick={() => setRefresh(value => value + 1)}>再読み込み</button></div>
          : topics.length === 0 ? <p className="topic-help">公開されているお題はまだありません。</p>
          : <>
            <label>コピー元のお題<select value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">公開のお題を選んでください</option>{topics.map(topic => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>
            {source && <p className="topic-help">候補 {source.candidates.length}件</p>}
            <p className="topic-help">現在の候補を置き換えます。コピー後に編集できます。</p>
            <Button type="button" variant="secondary" disabled={!source} onClick={() => { if (source) onCopy(source); }}>候補をコピー</Button>
          </>}
      </div>}
    </section>
  );
}
