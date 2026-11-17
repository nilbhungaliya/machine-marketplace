import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

// The single .env lives at the repo root (see /.env.example).
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
