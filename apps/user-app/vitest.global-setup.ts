/**
 * Force every test worker to run in UTC.
 *
 * Runs in vitest's MAIN process, before any worker is forked — the only place
 * this works: Node resolves the timezone once, on first `Date` use, and caches it.
 *
 * Why: every dev machine here sits on IST, so code that reads the DEVICE's local
 * calendar passes locally and breaks on a phone set to anything else.
 */
export default function setup() {
  process.env.TZ = 'UTC';
}
