// Ending a session from outside React (F1 spec §8.2): the axios interceptor in `lib/api.ts` reports a call the API
// refused because the account is suspended or blocked; `RootNavigator` listens, signs out and says why. Kept free of
// the store and of React so `api.ts` doesn't import either.

export type SessionEndReason = 'suspended';

/** Why a failed call ends the session, or null when it doesn't. */
export function sessionEndReason(err: { status?: number; code?: string }): SessionEndReason | null {
  return err.status === 403 && err.code === 'ACCOUNT_SUSPENDED' ? 'suspended' : null;
}

type Listener = (reason: SessionEndReason) => void;
const listeners = new Set<Listener>();

/** Subscribes; returns the unsubscribe. */
export function onSessionEnded(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifySessionEnded(reason: SessionEndReason): void {
  for (const listener of [...listeners]) {
    try {
      listener(reason);
    } catch {
      // One listener failing must not keep the others from signing out.
    }
  }
}
