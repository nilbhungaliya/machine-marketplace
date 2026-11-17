// Imported FIRST by index.ts. ESM evaluates imports in order, so Sentry is set
// up before Fastify (and node:http) load — it patches http on init and cannot
// instrument a server module that already loaded. No-op without SENTRY_DSN.
import './env.js';
import { initSentry } from './lib/sentry.js';

initSentry();
