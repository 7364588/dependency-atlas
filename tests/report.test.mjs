import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { analyzeFiles, compareSnapshots, renderReport } from '../dist/index.js';

test('the generated standalone viewer has syntactically valid JavaScript', () => {
  const snapshot = analyzeFiles(new Map([['a.ts', 'import "./b";'], ['b.ts', '']]));
  const html = renderReport(compareSnapshots(snapshot, snapshot));
  const script = html.split('<script>')[1].split('</script>')[0];
  assert.doesNotThrow(() => new Script(script));
  assert.ok(html.includes('id="graph"'));
});

test('hostile module names and source evidence remain inert data', () => {
  const payload = '</script><img src=x onerror="globalThis.compromised=true">';
  const snapshot = analyzeFiles(new Map([['app.ts', 'import ' + JSON.stringify(payload) + ';']]));
  const report = compareSnapshots(snapshot, snapshot), html = renderReport(report);
  assert.equal(html.includes(payload), false);
  const raw = html.split('<script id="atlas-data" type="application/json">')[1].split('</script>')[0];
  assert.deepEqual(JSON.parse(raw), report);
  assert.equal(html.includes('innerHTML'), false);
  assert.equal(html.includes('<script src='), false);
});

test('identical inputs produce byte-identical artifacts without timestamps', () => {
  const snapshot = analyzeFiles(new Map());
  const report = compareSnapshots(snapshot, snapshot);
  assert.equal(renderReport(report), renderReport(report));
});
