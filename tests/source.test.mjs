import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('../scripts/check-source.mjs', import.meta.url));
const directories = new Set();

after(() => {
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function inspect(files) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kambista-source-'));
  directories.add(directory);

  for (const [relative, source] of Object.entries(files)) {
    const filename = path.join(directory, relative);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, source);
  }

  const result = spawnSync(process.execPath, [checker], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null);
  return result;
}

test('rejects comments inside an otherwise empty block', () => {
  const result = inspect({ 'apps/api/empty.ts': 'export function empty() { /* blocked */ }\n' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /empty\.ts: contiene comentarios/);
});

test('rejects inline and trailing script comments', () => {
  for (const source of [
    'export const count = /* blocked */ 1;\n',
    'export const count = 1; // blocked\n',
  ]) {
    const result = inspect({ 'apps/api/inline.js': source });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /inline\.js: contiene comentarios/);
  }
});

test('rejects Vue HTML and CSS comments', () => {
  for (const source of [
    '<template><div><!-- blocked --></div></template>',
    '<template><div>Example</div></template><style>.example { /* blocked */ }</style>',
  ]) {
    const result = inspect({ 'apps/web/component.vue': source });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /component\.vue: contiene comentarios (HTML|CSS)/);
  }
});

test('accepts comment markers used only as literal data', () => {
  const script = [
    'const text = "/* literal */";',
    'const line = "// literal";',
    'const url = "https://example.com";',
    'const pattern = /\\/\\*/;',
    'const template = `/* literal */ // literal`;',
    'const interpolated = `${"/* literal */"}`;',
    'void [text, line, url, pattern, template, interpolated];',
  ].join('\n');
  const cases = [
    { 'apps/api/literal.ts': script },
    { 'scripts/literal.mjs': script },
    { 'apps/web/Literal.vue': `<script setup>${script}</script><template><div>Example</div></template>` },
    { 'apps/web/Literal.vue': '<template><div>Example</div></template><style>.example::after { content: "/* literal */"; }</style>' },
  ];

  for (const files of cases) {
    const result = inspect(files);
    assert.equal(result.status, 0, result.stderr);
  }
});

test('rejects documentation files and a source docs directory', () => {
  for (const files of [
    { 'README.md': 'Example' },
    { 'notes.MDX': 'Example' },
    { 'docs/design.json': '{}' },
  ]) {
    const result = inspect(files);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /documentación fuera de la entrega/);
  }
});

test('ignores dependency and build documentation and comments', () => {
  const result = inspect({
    'src/main.ts': 'export const value = 1;\n',
    'node_modules/vendor/README.md': 'Dependency documentation',
    'node_modules/vendor/docs/example.ts': '/* dependency comment */',
    'dist/README.md': 'Generated documentation',
    'dist/docs/example.js': '// generated comment\n',
  });

  assert.equal(result.status, 0, result.stderr);
});
