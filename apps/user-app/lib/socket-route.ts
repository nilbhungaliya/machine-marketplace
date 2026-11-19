/**
 * Which handler a `/user` socket event goes to, by its `<domain>:` prefix (F6 + F7 spec §13; CLAUDE.md "clients match
 * by prefix"): `message:` / `offer:` / `thread:` → chat, `deal:` → deals, `notification:` → notifications.
 */
export type SocketDomain = 'chat' | 'deals' | 'notifications';

export function socketDomain(event: string): SocketDomain | null {
  if (event.startsWith('message:') || event.startsWith('offer:') || event.startsWith('thread:')) return 'chat';
  if (event.startsWith('deal:')) return 'deals';
  if (event.startsWith('notification:')) return 'notifications';
  return null;
}
