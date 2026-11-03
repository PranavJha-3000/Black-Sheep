// Postgres without Docker (D-036): runs a real Postgres 16 from npm binaries on
// :5432 with the same credentials as docker-compose.yml, data in .pgdata/.
// Keep it running in its own terminal; Ctrl+C stops it.
//
//   npm run db:local
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';

const dir = '.pgdata';
const fresh = !existsSync(dir);
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port: 5432, persistent: true });

if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase('black_sheep');
console.log('Postgres ready on :5432 (db black_sheep). Ctrl+C to stop.');

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
