/**
 * Which handler a `/user` socket event goes to, by its `<domain>:` prefix (F6 + F7 spec §13; CLAUDE.md "clients match
 * by prefix"): `message:` / `offer:` / `thread:` → chat, `deal:` → deals, `notification:` → notifications.
 */
export type SocketDomain = 'chat' | 'deals' | 'notifications' | 'part_requests';

export function socketDomain(event: string): SocketDomain | null {
  if (event.startsWith('message:') || event.startsWith('offer:') || event.startsWith('thread:')) return 'chat';
  if (event.startsWith('deal:')) return 'deals';
  if (event.startsWith('notification:')) return 'notifications';
  // F8 §11: `part_request:updated { partRequestId, reason }`.
  if (event.startsWith('part_request:')) return 'part_requests';
  return null;
}
