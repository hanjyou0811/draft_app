import { useEffect, useRef, useState } from 'react';

import type { Credentials } from '../../shared/types.js';
import { CreateTopicForm } from './CreateTopicForm.js';
import { CreateRoomForm } from './CreateRoomForm.js';
import '../landing.css';

export function CreateRoom({ onCreated }: {
  readonly onCreated: (credentials: Credentials, persisted: boolean) => void;
}) {
  const [panel, setPanel] = useState<'topic' | 'room' | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedTopicId, setSelectedTopicId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (panel === null) {
      dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLInputElement>('[data-initial-focus]')?.focus();
  }, [panel]);

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
      <dialog
        ref={dialogRef}
        className="creation-dialog"
        aria-labelledby="create-title"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) setPanel(null);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget && !busy) setPanel(null);
        }}
      >
        <div className="creation-dialog__content">
          <button type="button" className="creation-dialog__close" aria-label="閉じる" disabled={busy} onClick={() => setPanel(null)}>×</button>
          <p className="step-label">{panel === 'topic' ? 'まずは、お題から。' : 'みんなで、ドラフト。'}</p>
          <h2 id="create-title">{panel === 'topic' ? 'お題をつくる' : 'ドラフト会議をつくる'}</h2>
          {panel === 'topic' && <CreateTopicForm onSaved={topic => setSelectedTopicId(topic.id)} onUseTopic={topic => { setSelectedTopicId(topic.id); setPanel('room'); }} onBusyChange={setBusy} />}
          {panel === 'room' && <CreateRoomForm initialTopicId={selectedTopicId} onCreateTopic={() => setPanel('topic')} onCreated={onCreated} onBusyChange={setBusy} />}
        </div>
      </dialog>
    </main>
  );
}
