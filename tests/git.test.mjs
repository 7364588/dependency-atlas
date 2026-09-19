import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createFixture } from '../scripts/fixture.mjs';
import { readGitSnapshot, compareSnapshots } from '../dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = join(root, '.test-work');
mkdirSync(scratch, { recursive: true });

function fixture(t) {
  const directory = mkdtempSync(join(scratch, 'repo-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const refs = createFixture(directory);
  return { directory, ...refs };
}

test('reads two real commits without changing checkout, index, or dirty files', t => {
  const { directory, base, head, git } = fixture(t);
  writeFileSync(join(directory, 'src', 'app.ts'), 'uncommitted local edit');
  writeFileSync(join(directory, 'untracked.ts'), 'import "./not-in-snapshot";');
  const before = git('status', '--porcelain=v1');
  const report = compareSnapshots(readGitSnapshot(directory, base), readGitSnapshot(directory, head));
  assert.equal(report.base.sha, base); assert.equal(report.head.sha, head);
  assert.equal(report.newCycles.length, 1);
  assert.equal(git('status', '--porcelain=v1'), before);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(report.head.modules.some(module => module.path === 'untracked.ts'), false);
});

test('repository source code and package scripts never execute', t => {
  const { directory, git } = fixture(t);
  writeFileSync(join(directory, 'malicious.js'), 'require("node:fs").writeFileSync("execution-marker", "wrong");');
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ scripts: { preinstall: 'node malicious.js', postinstall: 'node malicious.js' } }));
  git('add', '.'); git('commit', '-m', 'Add synthetic nonexecution sentinel');
  readGitSnapshot(directory, 'HEAD');
  assert.equal(existsSync(join(directory, 'execution-marker')), false);
});

test('refs beginning with options are not interpreted as Git command options', t => {
  const { directory } = fixture(t);
  assert.throws(() => readGitSnapshot(directory, '--help'), /Unable to read Git objects/);
});

test('resource limits expose skipped files and do not invent their edges', t => {
  const { directory, head } = fixture(t);
  const snapshot = readGitSnapshot(directory, head, { maxFiles: 100, maxFileBytes: 10, maxTotalBytes: 1000 });
  assert.ok(snapshot.coverage.skippedFiles > 0);
  assert.equal(snapshot.edges.length, 0);
});

test('CLI generates both usable report formats and errors on invalid refs', t => {
  const { directory, base, head } = fixture(t);
  const output = join(directory, 'report.html');
  const command = [join(root, 'dist', 'cli.js'), '--repo', directory, '--base', base, '--head', head, '--out', output];
  const result = spawnSync(process.execPath, command, { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(output, 'utf8'), /Dependency Atlas/);
  assert.equal(JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8')).head.sha, head);
  const invalid = spawnSync(process.execPath, [...command, '--head', 'missing-ref'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(invalid.status, 2);
  assert.equal(invalid.stderr.includes(directory), false);
});
