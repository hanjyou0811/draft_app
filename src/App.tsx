import { useCallback, useEffect, useState } from 'react';

import type { Credentials } from '../shared/types.js';
import { readCredentials, readCredentialState } from './api.js';
import { CreateRoom } from './components/CreateRoom.js';
import { DraftRoom } from './components/DraftRoom.js';
import { JoinRoom } from './components/JoinRoom.js';
import { WaitingRoom } from './components/WaitingRoom.js';
import { useRoom } from './useRoom.js';

function Header() {
  return (
    <header className="site-header">
      <a href="/" className="brand" aria-label="ドラフトルーム トップ">
        <img className="brand-mark" src="/logo.svg" width="44" height="44" alt="" />
        <span>DRAFT<br /><strong>ROOM</strong></span>
      </a>
      <p>ブラウザで遊べるドラフト会議</p>
    </header>
  );
}

function roomIdFromPath(pathname: string): string | undefined {
  const match = /^\/room\/([^/]+)\/?$/u.exec(pathname);
  if (match?.[1] === undefined) return undefined;
  try { return decodeURIComponent(match[1]); } catch { return ''; }
}

function ActiveRoom({ credentials }: { readonly credentials: Credentials }) {
  const controller = useRoom(credentials);
  if (controller.terminalError) {
    return <main className="center-card"><section className="paper-card"><h1>会議が見つかりません</h1><p>{controller.terminalError}</p><a href="/">新しい会議を作る</a></section></main>;
  }
  if (controller.authenticationLost) {
    return <main className="center-card"><section className="paper-card"><h1>参加情報を確認できません</h1><p>この端末に保存された参加情報は無効です。会議が開始済みの場合は、参加した端末から開いてください。</p><a href="/">新しい会議を作る</a></section></main>;
  }
  if (controller.room === undefined) return <main className="loading" role="status"><span className="ball-loader" aria-hidden="true" />{controller.syncStatus === 'reconnecting' ? '再接続中です…' : '会議に接続しています…'}</main>;
  return (
    <>
      {controller.message && <div className="global-message" role="alert"><span>{controller.message}</span><button type="button" onClick={controller.clearMessage} aria-label="メッセージを閉じる">×</button></div>}
      {controller.room.status === 'waiting'
        ? <WaitingRoom credentials={credentials} room={controller.room} syncStatus={controller.syncStatus} busy={controller.busy} onStart={() => void controller.start()} />
        : <DraftRoom room={controller.room} syncStatus={controller.syncStatus} busy={controller.busy} onPick={(candidateId) => void controller.pick(candidateId)} />}
    </>
  );
}

function RoomPage({ roomId, initialCredentials }: {
  readonly roomId: string;
  readonly initialCredentials?: Credentials;
}) {
  const [credentials] = useState(() => initialCredentials ?? readCredentials(roomId));
  return credentials === undefined
    ? <main className="center-card"><section className="paper-card"><h1>招待リンクが必要です</h1><p>ルームURLだけでは新しく参加できません。主催者から招待リンクを受け取って開いてください。</p><a href="/">トップに戻る</a></section></main>
    : <ActiveRoom credentials={credentials} />;
}

function invitationKeyFromPath(pathname: string): string | undefined {
  const match = /^\/invite\/([^/]+)\/?$/u.exec(pathname);
  if (match?.[1] === undefined) return undefined;
  try { return decodeURIComponent(match[1]); } catch { return ''; }
}

export function App() {
  const [pathname, setPathname] = useState(location.pathname);
  const [initialCredentials, setInitialCredentials] = useState<Credentials>();
  const [persistenceWarning, setPersistenceWarning] = useState(false);
  useEffect(() => {
    const onPopState = () => {
      const restoredRoomId = roomIdFromPath(location.pathname);
      const restored = restoredRoomId === undefined ? undefined : readCredentialState(restoredRoomId);
      setInitialCredentials(restored?.credentials);
      setPersistenceWarning(restored?.persisted === false);
      setPathname(location.pathname);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const onJoined = useCallback((joined: Credentials, persisted: boolean) => {
    setInitialCredentials(joined);
    setPersistenceWarning(!persisted);
    const nextPath = `/room/${encodeURIComponent(joined.roomId)}`;
    history.replaceState(null, '', nextPath);
    setPathname(nextPath);
  }, []);
  const roomId = roomIdFromPath(pathname);
  const inviteKey = invitationKeyFromPath(pathname);
  return (
    <div className="app-shell">
      {(roomId !== undefined || inviteKey !== undefined) && <Header />}
      {persistenceWarning && <div className="storage-warning" role="alert">参加情報を永続保存できませんでした。このタブを再読み込み・閉じると復帰できません。</div>}
      {inviteKey !== undefined
        ? <JoinRoom key={inviteKey} inviteKey={inviteKey} onJoined={onJoined} />
        : roomId === undefined
        ? <CreateRoom onCreated={(created, persisted) => {
          setInitialCredentials(created);
          setPersistenceWarning(!persisted);
          const nextPath = `/room/${encodeURIComponent(created.roomId)}`;
          history.pushState(null, '', nextPath);
          setPathname(nextPath);
        }} />
        : <RoomPage
          key={roomId}
          roomId={roomId}
          {...(initialCredentials?.roomId === roomId ? { initialCredentials } : {})}
        />}
      {roomId !== undefined && <footer>© DRAFT ROOM <span>FAIR PICKS. GREAT TEAMS.</span></footer>}
    </div>
  );
}
