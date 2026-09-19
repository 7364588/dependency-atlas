import { execFileSync } from 'node:child_process';
import { TextDecoder } from 'node:util';
import { analyzeFiles, isSource } from './analyze.js';
import type { Diagnostic, Snapshot } from './model.js';

export interface GitLimits { maxFiles: number; maxFileBytes: number; maxTotalBytes: number }
export const defaultLimits: GitLimits = { maxFiles: 5000, maxFileBytes: 1_048_576, maxTotalBytes: 50 * 1_048_576 };
const ignored = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor']);

function git(repo: string, args: string[], maxBuffer = 8 * 1_048_576): Buffer {
  try {
    return execFileSync('git', ['--no-pager', '-c', 'core.fsmonitor=false', ...args], { cwd: repo, maxBuffer, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch {
    throw new Error('Unable to read Git objects. Check the repository, refs, Git installation, and configured limits.');
  }
}

export function readGitSnapshot(repo: string, ref: string, limits: GitLimits = defaultLimits): Snapshot {
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Git limits must be positive safe integers');
  const sha = git(repo, ['rev-parse', '--verify', '--end-of-options', ref + '^{commit}']).toString('ascii').trim();
  if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('Reference did not resolve to a commit');
  const listing = git(repo, ['ls-tree', '-r', '-l', '-z', sha]);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let tree: string;
  try { tree = decoder.decode(listing); } catch { throw new Error('Git paths must use valid UTF-8'); }
  const files = new Map<string, string>();
  const diagnostics: Diagnostic[] = [];
  let total = 0, count = 0, skipped = 0;
  for (const record of tree.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    const path = record.slice(tab + 1), header = record.slice(0, tab).trim().split(/\s+/);
    if (tab < 0 || header.length !== 4) throw new Error('Unsupported Git tree entry');
    if ((!isSource(path) && path !== 'tsconfig.json') || path.split('/').some(part => ignored.has(part))) continue;
    if (header[0] === '120000' || header[1] !== 'blob') { skipped++; diagnostics.push({ file: path, message: 'Symlinks and non-blob entries are not followed.' }); continue; }
    const size = Number(header[3]);
    if (size > limits.maxFileBytes || total + size > limits.maxTotalBytes || count >= limits.maxFiles) {
      skipped++; diagnostics.push({ file: path, message: 'File skipped by an input resource limit.' }); continue;
    }
    const data = git(repo, ['cat-file', 'blob', header[2]!], limits.maxFileBytes + 1024);
    total += data.length; count++;
    try { files.set(path, decoder.decode(data)); }
    catch { skipped++; diagnostics.push({ file: path, message: 'File is not valid UTF-8.' }); }
  }
  const result = analyzeFiles(files, sha);
  result.coverage.skippedFiles = skipped;
  result.diagnostics.push(...diagnostics);
  return result;
}
