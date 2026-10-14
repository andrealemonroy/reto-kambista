import 'reflect-metadata';
import path from 'node:path';
import dotenv from 'dotenv';
import { createApplication } from './bootstrap/application';
import { loadConfig } from './bootstrap/config';

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
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'startup_failed', type: error instanceof Error ? error.name : 'UnknownError' })}\n`);
  process.exitCode = 1;
});
