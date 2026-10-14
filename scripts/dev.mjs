import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = spawn('npm', ['run', 'build', '-w', '@exchange/api'], { cwd: root, stdio: 'inherit' });
await new Promise((resolve, reject) => {
  build.once('error', reject);
  build.once('exit', (code) => code === 0 ? resolve() : reject(new Error('No se pudo compilar la API.')));
});
const children = [
  spawn(process.execPath, ['apps/api/dist/main.js'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], { cwd: path.join(root, 'apps/web'), stdio: 'inherit' }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
for (const child of children) {
  child.once('error', (error) => { process.stderr.write(`${error.message}\n`); stop(); process.exitCode = 1; });
  child.once('exit', (code) => { if (!stopping) { stop(); process.exitCode = code ?? 1; } });
}
