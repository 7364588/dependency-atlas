#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readGitSnapshot } from './git.js';
import { compareSnapshots } from './graph.js';
import { renderReport } from './report.js';

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + '.' + randomUUID() + '.tmp';
  try { writeFileSync(temporary, content, { flag: 'wx' }); renameSync(temporary, path); }
  finally { try { unlinkSync(temporary); } catch { /* Missing after a successful rename. */ } }
}

function main(): number {
  let values;
  try {
    ({ values } = parseArgs({ options: { repo: { type: 'string', default: '.' }, base: { type: 'string', default: 'HEAD~1' }, head: { type: 'string', default: 'HEAD' }, out: { type: 'string', default: 'dependency-atlas.html' }, json: { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' } } }));
  } catch { process.stderr.write('dependency-atlas: invalid arguments; use --help.\n'); return 2; }
  if (values.help) {
    process.stdout.write('Dependency Atlas\n\nUsage: dependency-atlas --repo <directory> --base <ref> --head <ref> --out <report.html> [--json <report.json>]\n\nReads Git objects without checkout or executing project code. Both HTML and JSON are written.\nDefaults: --repo . --base HEAD~1 --head HEAD --out dependency-atlas.html\nExit codes: 0 report created; 2 usage, Git, or output error.\n');
    return 0;
  }
  if (values.version) { process.stdout.write('dependency-atlas 0.1.0\n'); return 0; }
  const htmlPath = resolve(values.out!);
  const jsonPath = resolve(values.json ?? values.out!.slice(0, extname(values.out!).length ? -extname(values.out!).length : undefined) + '.json');
  if (htmlPath === jsonPath) { process.stderr.write('dependency-atlas: HTML and JSON destinations must differ.\n'); return 2; }
  try {
    const base = readGitSnapshot(values.repo!, values.base!), head = readGitSnapshot(values.repo!, values.head!);
    const report = compareSnapshots(base, head);
    atomicWrite(jsonPath, JSON.stringify(report, null, 2) + '\n');
    atomicWrite(htmlPath, renderReport(report));
    process.stdout.write('Report created: '+report.changes.length+' changed modules, '+report.addedEdges.length+' added and '+report.removedEdges.length+' removed references.\n');
    const gaps = head.coverage.unresolved + head.coverage.dynamic + head.coverage.parseErrors + head.coverage.skippedFiles + head.coverage.omittedReferences;
    if (gaps) process.stdout.write('Coverage has '+gaps+' unresolved, dynamic, parse-error, skipped, or omitted items. Review the Coverage panel.\n');
    return 0;
  } catch { process.stderr.write('dependency-atlas: unable to create report. Check Git refs, input limits, and output permissions.\n'); return 2; }
}

process.exitCode = main();
