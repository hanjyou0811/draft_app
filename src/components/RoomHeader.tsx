import type { RoomView } from '../../shared/types.js';
import type { SyncStatus } from '../useRoom.js';
import { ConnectionStatus } from './ConnectionStatus.js';
import '../room-workspace.css';

export function RoomHeader({ room, syncStatus }: { readonly room: RoomView; readonly syncStatus: SyncStatus }) {
  return (
    <header className="room-header">
      <a className="room-brand" href="/" aria-label="ドラフト トップ">ドラフト</a>
      <p className="room-topic" title={room.topic || 'ドラフト会議'}>{room.topic || 'ドラフト会議'}</p>
      <ConnectionStatus status={syncStatus} />
    </header>
  );
}
