import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFiles, compareSnapshots, cycles, upstreamPaths } from '../dist/index.js';

const scan = files => analyzeFiles(new Map(Object.entries(files)));

test('diff separates module changes from added and removed dependency identities', () => {
  const base = scan({ 'app.ts': 'import "./old";', 'old.ts': '', 'stable.ts': '' });
  const head = scan({ 'app.ts': 'import "./next";', 'next.ts': '', 'stable.ts': '' });
  const report = compareSnapshots(base, head);
  assert.deepEqual(report.changes, [{ path: 'app.ts', kind: 'modified' }, { path: 'next.ts', kind: 'added' }, { path: 'old.ts', kind: 'removed' }]);
  assert.equal(report.addedEdges[0].to, 'next.ts');
  assert.equal(report.removedEdges[0].to, 'old.ts');
});

test('line shifts change evidence without inventing new references', () => {
  const report = compareSnapshots(scan({ 'a.ts': 'import "./b";', 'b.ts': '' }), scan({ 'a.ts': '\n\nimport "./b";', 'b.ts': '' }));
  assert.equal(report.addedEdges.length, 0);
  assert.equal(report.head.edges[0].evidence[0].line, 3);
});

test('reverse paths are deterministic, finite with cycles, and respect depth', () => {
  const snapshot = scan({ 'a.ts': 'import "./b";', 'b.ts': 'import "./c";', 'c.ts': 'import "./b";', 'd.ts': 'import "./a";' });
  assert.deepEqual(upstreamPaths(snapshot, 'c.ts', 1), [{ module: 'b.ts', path: ['b.ts', 'c.ts'] }]);
  assert.deepEqual(upstreamPaths(snapshot, 'c.ts').map(item => item.module), ['b.ts', 'a.ts', 'd.ts']);
  assert.deepEqual(upstreamPaths(snapshot, 'missing'), []);
});

test('cycles report SCC groups including self references, not every possible loop', () => {
  const snapshot = scan({ 'a.ts': 'import "./b";', 'b.ts': 'import "./a";', 'c.ts': 'import "./c";', 'd.ts': '' });
  assert.deepEqual(cycles(snapshot), [['a.ts', 'b.ts'], ['c.ts']]);
  assert.deepEqual(compareSnapshots(snapshot, snapshot).newCycles, []);
});

test('expanded cyclic groups are reported even when a smaller group existed', () => {
  const base = scan({ 'a.ts': 'import "./b";', 'b.ts': 'import "./a";', 'c.ts': '' });
  const head = scan({ 'a.ts': 'import "./b";', 'b.ts': 'import "./a"; import "./c";', 'c.ts': 'import "./a";' });
  assert.deepEqual(compareSnapshots(base, head).newCycles, [['a.ts', 'b.ts', 'c.ts']]);
});
