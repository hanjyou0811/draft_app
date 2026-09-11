import type { SyncStatus } from '../useRoom.js';

export function ConnectionStatus({ status }: { readonly status: SyncStatus }) {
  const synced = status === 'synced';
  return (
    <div className={`connection ${synced ? 'connection--synced' : ''}`} role="status" aria-live="polite">
      <span className="connection__dot" aria-hidden="true" />
      {synced ? '同期済み' : status === 'connecting' ? '接続中' : '再接続中'}
    </div>
  );
}
