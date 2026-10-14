import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parse } from '@vue/compiler-sfc';
import { parse as parseTemplate, NodeTypes } from '@vue/compiler-dom';
import postcss from 'postcss';

const excluded = new Set(['node_modules', 'dist', '.git', '.runtime', '.local-planning', 'coverage', 'test-results']);
const failures = [];

function inspectScript(source, filename) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const comments = new Set();
  const visit = (node) => {
    for (const range of [...(ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []), ...(ts.getTrailingCommentRanges(source, node.getEnd()) ?? [])]) {
      comments.add(range.pos);
    }
    for (const child of node.getChildren(tree)) visit(child);
  };
  visit(tree);
  if (comments.size) failures.push(`${filename}: contiene comentarios`);
}

function inspectTemplate(source, filename) {
  const visit = (node) => {
    if (node.type === NodeTypes.COMMENT) failures.push(`${filename}: contiene comentarios HTML`);
    for (const child of node.children ?? []) visit(child);
  };
  visit(parseTemplate(source, { comments: true }));
}

function inspectCss(source, filename) {
  postcss.parse(source, { from: filename }).walkComments(() => failures.push(`${filename}: contiene comentarios CSS`));
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'docs') failures.push(`${filename}: documentación fuera de la entrega`);
      else walk(filename);
      continue;
    }
    if (/\.(md|mdx)$/i.test(entry.name)) failures.push(`${filename}: documentación fuera de la entrega`);
    const source = fs.readFileSync(filename, 'utf8');
    if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(entry.name)) inspectScript(source, filename);
    if (entry.name.endsWith('.vue')) {
      const { descriptor } = parse(source);
      for (const block of [descriptor.script, descriptor.scriptSetup]) if (block) inspectScript(block.content, filename);
      if (descriptor.template) inspectTemplate(descriptor.template.content, filename);
      for (const style of descriptor.styles) inspectCss(style.content, filename);
    }
    if (entry.name.endsWith('.html')) inspectTemplate(source, filename);
    if (entry.name.endsWith('.css')) inspectCss(source, filename);
  }
}

walk(process.cwd());
if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Código sin comentarios ni archivos de documentación.\n');
}
