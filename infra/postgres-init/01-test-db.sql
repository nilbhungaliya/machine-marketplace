-- Runs once, when the pgdata volume is first created (docker-entrypoint-initdb.d).
-- Tests use their own database (apps/api/vitest.config.ts refuses any name not ending in _test).
CREATE DATABASE mpm_test OWNER mpm;
