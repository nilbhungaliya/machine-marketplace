/** True for a Postgres unique violation (23505), optionally for one named constraint. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  if (e.code !== '23505') return false;
  return constraint === undefined || e.constraint === constraint;
}

/** True for a Postgres foreign key violation (23503). */
export function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23503';
}

/** True for a Postgres check violation (23514), optionally for one named constraint. */
export function isCheckViolation(err: unknown, constraint?: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  if (e.code !== '23514') return false;
  return constraint === undefined || e.constraint === constraint;
}

/**
 * True for a deadlock (40P01) or serialization failure (40001): two edits collided and Postgres aborted one.
 * Nothing is wrong with the request; running it again succeeds.
 */
export function isConcurrencyFailure(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === '40P01' || code === '40001';
}
