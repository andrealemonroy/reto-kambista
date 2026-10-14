import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const live = process.argv.includes('--live');
const mongo = await MongoMemoryServer.create({
  binary: { version: '8.0.16', downloadDir: path.join(root, '.runtime/mongodb-binaries') },
  instance: { ip: '127.0.0.1', dbName: 'kambista_demo', launchTimeout: 60000 },
});
const environment = {
  ...process.env,
  MONGODB_URI: mongo.getUri(),
  MONGODB_DATABASE: 'kambista_demo',
  JWT_SECRET: randomBytes(48).toString('hex'),
  RATE_PROVIDER_MODE: live ? 'live' : 'fixture',
  PORT: process.env.PORT ?? '4000',
  WEB_ORIGIN: 'http://127.0.0.1:5173',
  VITE_API_URL: `http://127.0.0.1:${process.env.PORT ?? '4000'}`,
  VITE_DEMO_MODE: live ? 'false' : 'true',
};
process.stdout.write(`MongoDB temporal y ${live ? 'tasas del proveedor SUNAT' : 'tasas de ejemplo'}. Los datos se eliminan al cerrar.\n`);
const dev = spawn(process.execPath, ['scripts/dev.mjs'], { cwd: root, env: environment, stdio: 'inherit' });
let cleanup;
function stop() {
  if (!cleanup) {
    cleanup = (async () => {
      if (dev.exitCode === null && dev.signalCode === null) {
        dev.kill('SIGTERM');
        await new Promise((resolve) => dev.once('exit', resolve));
      }
      await mongo.stop();
    })();
  }
  return cleanup;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void stop());
dev.once('error', () => { process.exitCode = 1; void stop(); });
dev.once('exit', (code) => { process.exitCode = code ?? 1; void stop(); });
