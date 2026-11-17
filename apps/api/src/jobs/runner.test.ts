import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { buildApp } from '../app.js';
import { startJob, startJobs } from './runner.js';

function spyLogger() {
  const error = vi.fn();
  const log = { error, info: vi.fn(), warn: vi.fn(), debug: vi.fn() } as unknown as FastifyBaseLogger;
  return { log, error };
}

const fakeTimers = { toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const };

describe('job runner', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [...fakeTimers.toFake] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never overlaps two runs of the same job: a tick while running is skipped', async () => {
    const { log } = spyLogger();
    const run = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 2500)));
    const stop = startJob(log, { name: 'slow', everyMs: 1000, run });
    // Ticks at 1000 (runs until 3500), 2000 and 3000 (skipped: still running), 4000 (runs).
    await vi.advanceTimersByTimeAsync(4000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it('waits firstRunMs (default everyMs) before the first run', async () => {
    const { log } = spyLogger();
    const run = vi.fn(async () => undefined);
    const stopDefault = startJob(log, { name: 'default-first', everyMs: 1000, run });
    await vi.advanceTimersByTimeAsync(999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    stopDefault();

    const early = vi.fn(async () => undefined);
    const stopEarly = startJob(log, { name: 'early', everyMs: 10_000, firstRunMs: 50, run: early });
    await vi.advanceTimersByTimeAsync(50);
    expect(early).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(early).toHaveBeenCalledTimes(2);
    stopEarly();
  });

  it('logs and swallows a failing run, and the next tick still runs', async () => {
    const { log, error } = spyLogger();
    const run = vi.fn(async () => {
      throw new Error('boom');
    });
    const stop = startJob(log, { name: 'flaky', everyMs: 1000, run });
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls[0])).toContain('flaky');
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(2);
    stop();
  });

  it('the stop function prevents further runs, including before the first one', async () => {
    const { log } = spyLogger();
    const run = vi.fn(async () => undefined);
    const stop = startJob(log, { name: 'stopped', everyMs: 1000, run });
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(1);

    const never = vi.fn(async () => undefined);
    startJob(log, { name: 'never', everyMs: 1000, run: never })();
    await vi.advanceTimersByTimeAsync(5000);
    expect(never).not.toHaveBeenCalled();
  });

  it('startJobs stops every job when the app closes (before the app has started)', async () => {
    const app = await buildApp({ infra: false, logger: false });
    const a = vi.fn(async () => undefined);
    const b = vi.fn(async () => undefined);
    startJobs(app, [
      { name: 'a', everyMs: 1000, run: a },
      { name: 'b', everyMs: 1000, run: b },
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    await app.close();
    await vi.advanceTimersByTimeAsync(5000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('startJobs also works after listen (index.ts starts jobs once the server is up)', async () => {
    vi.useRealTimers();
    const app = await buildApp({ infra: false, logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const run = vi.fn(async () => undefined);
    startJobs(app, [{ name: 'late', everyMs: 20, run }]);
    await new Promise((r) => setTimeout(r, 70));
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(1);
    await app.close();
    const calls = run.mock.calls.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(run).toHaveBeenCalledTimes(calls);
  });
});
