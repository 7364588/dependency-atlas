import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixture } from './fixture.mjs';
import { readGitSnapshot, compareSnapshots, renderReport } from '../dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const work = join(root, '.demo-work');
mkdirSync(work, { recursive: true });
const directory = mkdtempSync(join(work, 'repo-'));
try {
  const refs = createFixture(directory);
  const report = compareSnapshots(readGitSnapshot(directory, refs.base), readGitSnapshot(directory, refs.head));
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'demo.html'), renderReport(report));
  writeFileSync(join(root, 'docs', 'demo.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('Synthetic demo created: docs/demo.html and docs/demo.json');
} finally {
  if (resolve(directory).startsWith(resolve(work) + '/')) rmSync(directory, { recursive: true, force: true });
  else if (resolve(directory).startsWith(resolve(work) + '\\')) rmSync(directory, { recursive: true, force: true });
}
