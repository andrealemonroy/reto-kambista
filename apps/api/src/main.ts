import 'reflect-metadata';
import path from 'node:path';
import dotenv from 'dotenv';
import { createApplication } from './bootstrap/application';
import { loadConfig } from './bootstrap/config';
import { startupError } from './bootstrap/startup-error';

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

async function start(): Promise<void> {
  const config = loadConfig();
  const { app } = await createApplication(config);
  try {
    await app.listen(config.port, config.host);
  } catch (error) {
    await app.close();
    throw error;
  }
}

void start().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'startup_failed', ...startupError(error) })}\n`);
  process.exitCode = 1;
});
