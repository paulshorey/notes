#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const temp = await mkdtemp(path.join(tmpdir(), 'atomic-editor-package-'));

try {
  const { stdout } = await exec(
    npm,
    ['pack', '--json', '--pack-destination', temp],
    { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024, timeout: 120_000 },
  );
  const [{ filename }] = JSON.parse(stdout);
  const tarball = path.join(temp, filename);

  await writeFile(
    path.join(temp, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  await exec(
    npm,
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
    { cwd: temp, maxBuffer: 10 * 1024 * 1024, timeout: 120_000 },
  );

  await writeFile(
    path.join(temp, 'index.html'),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>',
  );
  await writeFile(
    path.join(temp, 'main.jsx'),
    `import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  AtomicCodeMirrorEditor,
  highlightMarkdown,
  startAsteriskList,
} from '@atomic-editor/editor';
import { ATOMIC_CODE_LANGUAGES } from '@atomic-editor/editor/code-languages';
import '@atomic-editor/editor/styles.css';

if (!highlightMarkdown || !startAsteriskList || !ATOMIC_CODE_LANGUAGES.length) {
  throw new Error('documented public exports are missing');
}

createRoot(document.getElementById('root')).render(
  React.createElement(AtomicCodeMirrorEditor, { markdownSource: '# package smoke' }),
);
`,
  );

  const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  await exec(process.execPath, [viteBin, 'build'], {
    cwd: temp,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  });

  const installed = JSON.parse(
    await readFile(
      path.join(temp, 'node_modules', '@atomic-editor', 'editor', 'package.json'),
      'utf8',
    ),
  );

  console.log(`package smoke passed for @atomic-editor/editor@${installed.version}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
