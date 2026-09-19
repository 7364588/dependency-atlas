import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFiles } from '../dist/index.js';

const scan = files => analyzeFiles(new Map(Object.entries(files)), 'fixture');
const reference = (result, specifier) => result.edges.find(edge => edge.specifier === specifier);

test('AST extracts imports, re-exports, and literal require, ignoring comments and strings', () => {
  const report = scan({ 'app.ts': '// import fake from "./fake";\nconst text = "require(ghost)";\nimport { x } from "./a"; export * from "./b"; const c = require("./c");', 'a.ts': 'export const x=1;', 'b/index.ts': 'export const y=1;', 'c.js': 'module.exports=1;' });
  assert.equal(report.edges.length, 3);
  assert.equal(reference(report, './a').to, 'a.ts');
  assert.equal(reference(report, './b').to, 'b/index.ts');
  assert.equal(reference(report, './c').kind, 'require');
  assert.equal(reference(report, './a').evidence[0].line, 3);
});

test('TSX syntax and mixed type imports are parsed accurately', () => {
  const result = scan({ 'app.tsx': 'import { type Model, value } from "./model";\nimport type { Shape } from "./shape";\nexport type { Shape } from "./shape";\nconst view = <div>{value}</div>;', 'model.ts': 'export const value=1; export type Model=number;', 'shape.ts': 'export type Shape=number;' });
  assert.equal(result.coverage.parseErrors, 0);
  assert.equal(reference(result, './model').typeOnly, false);
  assert.equal(result.edges.filter(edge => edge.typeOnly).length, 2);
});

test('type-only named clauses and TypeScript import-equals are recognized', () => {
  const result = scan({ 'a.ts': 'import {type X} from "./x"; import y = require("./y");', 'x.ts': 'export type X=1;', 'y.ts': 'export = 1;' });
  assert.equal(reference(result, './x').typeOnly, true);
  assert.equal(reference(result, './y').status, 'internal');
});

test('relative JS, MJS and CJS extensions resolve to TypeScript declarations', () => {
  const result = scan({ 'a.ts': 'import "./one.js"; import "./two.mjs"; import "./three.cjs";', 'one.ts': '', 'two.d.mts': '', 'three.d.cts': '' });
  assert.deepEqual(result.edges.map(edge => edge.to).sort(), ['one.ts', 'three.d.cts', 'two.d.mts']);
});

test('root JSONC paths, wildcard matching and baseUrl resolution', () => {
  const result = scan({ 'tsconfig.json': '{// config\n"compilerOptions":{"baseUrl":"src","paths":{"@/*":["*"],"exact":["util/index"]}}}', 'src/app.ts': 'import "@/util"; import "exact"; import "util";', 'src/util/index.ts': '' });
  assert.equal(result.coverage.internal, 3);
  assert.ok(result.edges.every(edge => edge.to === 'src/util/index.ts'));
});

test('alias paths are not resolved outside the repository', () => {
  const result = scan({ 'tsconfig.json': '{"compilerOptions":{"paths":{"escape":["../outside"]}}}', 'app.ts': 'import "escape"; import "../outside";' });
  assert.equal(result.coverage.unresolved, 2);
});

test('config inheritance is surfaced instead of silently followed', () => {
  const result = scan({ 'tsconfig.json': '{"extends":"./base.json"}', 'app.ts': '' });
  assert.ok(result.diagnostics.some(item => item.message.includes('extends')));
});

test('external packages, unresolved relatives, and computed targets stay distinct', () => {
  const result = scan({ 'app.ts': 'import "node:fs"; import "react"; import "./missing"; import(name); require(variable); import("./lazy");', 'lazy.ts': '' });
  assert.equal(result.coverage.external, 2);
  assert.equal(result.coverage.unresolved, 1);
  assert.equal(result.coverage.dynamic, 2);
  assert.equal(reference(result, './lazy').kind, 'dynamic-import');
  assert.equal(reference(result, './lazy').to, 'lazy.ts');
});

test('locally shadowed require cannot invent an internal dependency', () => {
  for (const code of ['function f(require: any) { return require("./x"); }', 'const require=(x:string)=>x; require("./x");', 'import require from "custom-loader"; require("./x");']) {
    const result = scan({ 'app.ts': code, 'x.ts': '' });
    const edge = reference(result, './x');
    assert.equal(edge.status, 'dynamic'); assert.equal(edge.to, null);
    assert.match(edge.reason, /Locally declared/);
  }
});

test('malformed syntax produces coverage diagnostics and no recovery-tree edges', () => {
  const result = scan({ 'app.ts': 'import { from "./x"; const = ;', 'x.ts': '' });
  assert.ok(result.coverage.parseErrors > 0);
  assert.equal(result.edges.length, 0);
});

test('duplicate references retain separate evidence without duplicating graph edges', () => {
  const result = scan({ 'app.ts': 'require("./x");\nrequire("./x");', 'x.ts': '' });
  assert.equal(result.edges.length, 1);
  assert.deepEqual(result.edges[0].evidence.map(proof => proof.line), [1, 2]);
});

test('evidence excerpts bound long statement and long-line amplification', () => {
  const result = scan({ 'app.ts': 'import {' + 'a,'.repeat(700) + 'b} from "./x"; ' + 'require("./x");'.repeat(100), 'x.ts': '' });
  assert.ok(result.edges.every(edge => edge.evidence.every(proof => proof.text.length <= 500)));
  assert.ok(result.edges.some(edge => edge.evidence.some(proof => proof.truncated)));
  assert.ok(JSON.stringify(result).length < 40000);
});

test('snapshot output is independent of map insertion order', () => {
  const entries = [['a.ts', 'import "./b";'], ['b.ts', 'export const x=1;']];
  assert.deepEqual(analyzeFiles(new Map(entries), 'same'), analyzeFiles(new Map([...entries].reverse()), 'same'));
});

test('the reference occurrence budget is explicit and preserves omitted counts', () => {
  const result = scan({ 'app.ts': 'require("./x");'.repeat(20_003), 'x.ts': '' });
  assert.equal(result.coverage.omittedReferences, 3);
  assert.equal(result.edges[0].evidence.length, 20_000);
  assert.ok(result.diagnostics.some(item => item.message.includes('budget')));
});
