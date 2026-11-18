import { ConflictError } from '../../lib/errors.js';

/**
 * A reorder sends the full list in its new order. Anything other than exactly the current ids
 * (missing, extra or repeated) means the admin's view is stale: STALE_ORDER, before any write.
 * `what` names the list in the message ("categories", "fields"…).
 */
export function assertExactSet(current: { id: string }[], orderedIds: string[], what: string): void {
  const ids = new Set(current.map((r) => r.id));
  const exact =
    orderedIds.length === ids.size && new Set(orderedIds).size === orderedIds.length && orderedIds.every((id) => ids.has(id));
  if (!exact) throw new ConflictError(`The list of ${what} has changed; reload and try again`, 'STALE_ORDER');
}
