import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { MEDIA_STORAGE_ENV, MEDIA_STORAGE_PRODUCTION_ENV, isMediaStorageConfigured } from '../../src/lib/storage.js';

// The R2 round-trip suites (F2 plan Tasks 11, 13) run only with `R2_TESTS=1` and real keys. `vitest.config.ts` blanks
// the public media variables (and the Cloudflare ones) so a developer's .env never leaks into a plain run; these suites
// take them back from the root .env when, and only when, `R2_TESTS=1`.

export const R2_SKIP_MESSAGE = 'R2 round trips skipped: set R2_TESTS=1 with R2 keys to run them';

const VARS = [...MEDIA_STORAGE_ENV, ...MEDIA_STORAGE_PRODUCTION_ENV];
const saved: Record<string, string | undefined> = {};

/**
 * True when the R2 suites should run: `R2_TESTS=1`, and media storage configured once the root .env's values are put
 * back for the variables the test env blanked. Prints the skip message otherwise. Call at collection time.
 */
export function r2TestsEnabled(): boolean {
  if (process.env.R2_TESTS !== '1') {
    console.info(R2_SKIP_MESSAGE);
    return false;
  }
  const fileEnv = loadEnv({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), processEnv: {} }).parsed ?? {};
  for (const name of VARS) {
    saved[name] = process.env[name];
    if (!(process.env[name] ?? '').trim() && fileEnv[name]) process.env[name] = fileEnv[name];
  }
  if (!isMediaStorageConfigured()) {
    restoreR2Env();
    console.info(`${R2_SKIP_MESSAGE} (R2_TESTS=1, but the media variables aren't all set: ${MEDIA_STORAGE_ENV.join(', ')})`);
    return false;
  }
  return true;
}

/** Puts the variables `r2TestsEnabled` changed back as they were. */
export function restoreR2Env(): void {
  for (const name of Object.keys(saved)) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
    delete saved[name];
  }
}
