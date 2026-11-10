import type { SyncStatus } from '../useRoom.js';

export function ConnectionStatus({ status }: { readonly status: SyncStatus }) {
  if (status === 'synced') return null;
  return (
    <div className="connection" role="status" aria-live="polite">
      <span className="connection__dot" aria-hidden="true" />
      {status === 'connecting' ? '接続中' : '再接続中'}
    </div>
  );
}
