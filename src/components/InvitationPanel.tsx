import { useCallback, useEffect, useRef, useState } from 'react';

import type { Credentials } from '../../shared/types.js';
import { api } from '../api.js';

interface InvitationPanelProps {
  readonly credentials: Credentials;
  readonly version: number;
}

export function InvitationPanel({ credentials, version }: InvitationPanelProps) {
  const [inviteKey, setInviteKey] = useState<string>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [refresh, setRefresh] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const serial = useRef(0);
  const rotating = useRef(false);
  const pendingRefresh = useRef(false);
  const inviteUrl = inviteKey ? `${location.origin}/invite/${encodeURIComponent(inviteKey)}` : '';

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      serial.current += 1;
    };
  }, []);

  const load = useCallback(async (rotate = false) => {
    if (rotating.current) return;
    const request = ++serial.current;
    rotating.current = rotate;
    setInviteKey(undefined);
    setCopyStatus('');
    setError('');
    setBusy(true);
    try {
      const result = await (rotate ? api.rotateInvitation(credentials) : api.getInvitation(credentials));
      if (!mounted.current || request !== serial.current) return;
      setInviteKey(result.inviteKey);
    } catch {
      if (!mounted.current || request !== serial.current) return;
      setError(rotate
        ? '招待リンクの再発行結果を確認できませんでした。再読み込みして現在のリンクを確認してください。'
        : '招待リンクを取得できませんでした。再読み込みしてください。');
    } finally {
      if (mounted.current && request === serial.current) {
        rotating.current = false;
        setBusy(false);
        if (pendingRefresh.current) {
          pendingRefresh.current = false;
          setRefresh((value) => value + 1);
        }
      }
    }
  }, [credentials.roomId, credentials.token]);

  useEffect(() => {
    if (rotating.current) pendingRefresh.current = true;
    else void load();
  }, [load, version, refresh]);

  const copy = async () => {
    const request = serial.current;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      if (mounted.current && request === serial.current) setCopyStatus('コピーしました');
    } catch {
      if (!mounted.current || request !== serial.current) return;
      inputRef.current?.focus();
      inputRef.current?.select();
      setCopyStatus('URLを選択しました。手動でコピーしてください。');
    }
  };

  return (
    <div className="waiting-invite" aria-busy={busy}>
      <h2>仲間を招待</h2>
      <p>招待URLを共有して、参加者を招待できます。</p>
      {busy && <p role="status">招待リンクを読み込み中…</p>}
      {error && <><p role="alert">{error}</p><button className="secondary-button" type="button" onClick={() => void load()}>再読み込み</button></>}
      {inviteKey && <>
        <label htmlFor="invite-url">招待URL</label>
        <input ref={inputRef} id="invite-url" value={inviteUrl} readOnly onFocus={event => event.currentTarget.select()} />
        <button className="secondary-button" type="button" onClick={() => void copy()}>URLをコピー</button>
        <p role="status">{copyStatus}</p>
      </>}
      <p>再発行すると、古いリンクから新しく参加できなくなります。参加済みの人はそのまま利用できます。</p>
      <button className="room-text-button" type="button" disabled={busy || !inviteKey} onClick={() => void load(true)}>招待リンクを再発行</button>
    </div>
  );
}
