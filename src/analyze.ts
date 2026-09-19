import ts from 'typescript';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { Diagnostic, Edge, EdgeKind, Evidence, Snapshot } from './model.js';

export const isSource = (file: string): boolean => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(file);
const extensions = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const withinRoot = (value: string): boolean => !posix.isAbsolute(value) && value !== '..' && !value.startsWith('../') && !value.includes('\\');

interface Resolver { baseUrl: string | null; paths: [string, string[]][] }

function settings(files: ReadonlyMap<string, string>, diagnostics: Diagnostic[]): Resolver {
  const raw = files.get('tsconfig.json');
  if (raw === undefined) return { baseUrl: null, paths: [] };
  const parsed = ts.parseConfigFileTextToJson('tsconfig.json', raw);
  if (parsed.error) {
    diagnostics.push({ file: 'tsconfig.json', message: 'Invalid JSONC configuration; aliases are unavailable.' });
    return { baseUrl: null, paths: [] };
  }
  const config = parsed.config;
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    diagnostics.push({ file: 'tsconfig.json', message: 'Configuration must be an object; aliases are unavailable.' });
    return { baseUrl: null, paths: [] };
  }
  if (config.extends) diagnostics.push({ file: 'tsconfig.json', message: 'extends is not followed; only this root configuration is read.' });
  if (config.references) diagnostics.push({ file: 'tsconfig.json', message: 'Project references are not followed.' });
  const compiler = config.compilerOptions && typeof config.compilerOptions === 'object' ? config.compilerOptions : {};
  let baseUrl: string | null = null;
  if (typeof compiler.baseUrl === 'string') {
    const normalized = posix.normalize(compiler.baseUrl);
    if (withinRoot(normalized)) baseUrl = normalized;
    else diagnostics.push({ file: 'tsconfig.json', message: 'baseUrl outside the repository or using backslashes is unsupported.' });
  }
  const paths: [string, string[]][] = [];
  if (compiler.paths && typeof compiler.paths === 'object' && !Array.isArray(compiler.paths)) {
    for (const [key, value] of Object.entries(compiler.paths)) {
      if ((key.match(/\*/g)?.length ?? 0) > 1 || !Array.isArray(value) || !value.every(v => typeof v === 'string' && (v.match(/\*/g)?.length ?? 0) <= 1)) {
        diagnostics.push({ file: 'tsconfig.json', message: 'An unsupported paths entry was ignored; targets must be strings with at most one wildcard.' });
        continue;
      }
      paths.push([key, value]);
    }
    paths.sort((a, b) => {
      const exact = Number(b[0].indexOf('*') < 0) - Number(a[0].indexOf('*') < 0);
      return exact || b[0].split('*')[0]!.length - a[0].split('*')[0]!.length || a[0].localeCompare(b[0], 'en');
    });
  }
  return { baseUrl, paths };
}

function resolveCandidate(candidate: string, modules: Set<string>): string | null {
  const path = posix.normalize(candidate);
  if (!withinRoot(path)) return null;
  const swapped = /\.([cm]?)js$/.exec(path);
  const candidates: string[] = [];
  if (swapped) {
    const stem = path.slice(0, -swapped[0].length);
    const prefix = swapped[1] ?? '';
    candidates.push(stem + '.' + prefix + 'ts');
    if (prefix) candidates.push(stem + '.d.' + prefix + 'ts');
    if (!prefix) candidates.push(stem + '.tsx', stem + '.d.ts');
  }
  candidates.push(path, ...extensions.map(ext => path + ext), ...extensions.map(ext => path + '/index' + ext));
  return candidates.find(item => modules.has(item)) ?? null;
}

function resolve(from: string, specifier: string | null, modules: Set<string>, options: Resolver): Pick<Edge, 'status' | 'to'> {
  if (specifier === null) return { status: 'dynamic', to: null };
  if (specifier.startsWith('.')) {
    const to = resolveCandidate(posix.join(posix.dirname(from), specifier), modules);
    return { status: to ? 'internal' : 'unresolved', to };
  }
  if (specifier.startsWith('/') || specifier.includes('\\')) return { status: 'unresolved', to: null };
  for (const [pattern, targets] of options.paths) {
    const star = pattern.indexOf('*');
    let middle: string;
    if (star < 0) { if (pattern !== specifier) continue; middle = ''; }
    else {
      const prefix = pattern.slice(0, star), suffix = pattern.slice(star + 1);
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix) || specifier.length < prefix.length + suffix.length) continue;
      middle = specifier.slice(prefix.length, specifier.length - suffix.length);
    }
    for (const target of targets) {
      const expanded = target.replace('*', middle);
      if (!withinRoot(expanded)) continue;
      const to = resolveCandidate(posix.join(options.baseUrl ?? '.', expanded), modules);
      if (to) return { status: 'internal', to };
    }
    return { status: 'unresolved', to: null };
  }
  if (options.baseUrl !== null) {
    const to = resolveCandidate(posix.join(options.baseUrl, specifier), modules);
    if (to) return { status: 'internal', to };
  }
  return { status: 'external', to: null };
}

/** Analyze supplied repository-relative files; no imports or project scripts execute. */
export function analyzeFiles(files: ReadonlyMap<string, string>, sha = 'snapshot'): Snapshot {
  const diagnostics: Diagnostic[] = [];
  const options = settings(files, diagnostics);
  const sourcePaths = [...files.keys()].filter(isSource).sort();
  const modules = new Set(sourcePaths);
  const parsedFiles = new Map(sourcePaths.map(file => [file, ts.createSourceFile(file, files.get(file)!, ts.ScriptTarget.Latest, true)]));
  const root = '/dependency-atlas/';
  const relative = (file: string): string => file.startsWith(root) ? file.slice(root.length) : file;
  const host: ts.CompilerHost = {
    getSourceFile: file => parsedFiles.get(relative(file)),
    getDefaultLibFileName: () => '', writeFile: () => {},
    getCurrentDirectory: () => root, getDirectories: () => [],
    fileExists: file => files.has(relative(file)), readFile: file => files.get(relative(file)),
    getCanonicalFileName: file => file, useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const checker = ts.createProgram(sourcePaths.map(file => root + file), { noResolve: true, noLib: true, allowJs: true, target: ts.ScriptTarget.Latest }, host).getTypeChecker();
  const edges = new Map<string, Edge>();
  let parseErrors = 0, occurrences = 0, omittedReferences = 0;
  for (const file of sourcePaths) {
    const text = files.get(file)!;
    const source = parsedFiles.get(file)!;
    const parseDiagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
    for (const diagnostic of parseDiagnostics) {
      parseErrors++;
      diagnostics.push({ file, line: source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') });
    }
    if (parseDiagnostics.length) continue; // Recovery trees are not dependency evidence.
    const record = (node: ts.Node, specifier: string | null, kind: EdgeKind, typeOnly = false, reason?: string): void => {
      if (occurrences++ >= 20_000) { omittedReferences++; return; }
      const start = node.getStart(source), end = node.getEnd();
      const position = source.getLineAndCharacterOfPosition(start);
      const evidence: Evidence = { file, line: position.line + 1, column: position.character + 1, text: text.slice(start, Math.min(end, start + 500)), truncated: end - start > 500 };
      const resolution: Pick<Edge, 'status' | 'to'> = reason ? { status: 'dynamic', to: null } : resolve(file, specifier, modules, options);
      const id = hash(JSON.stringify([file, specifier, kind, typeOnly, resolution.status, resolution.to, specifier === null ? node.getText(source) : null])).slice(0, 24);
      const existing = edges.get(id);
      if (existing) existing.evidence.push(evidence);
      else edges.set(id, { id, from: file, specifier, kind, typeOnly, ...resolution, evidence: [evidence], ...(reason ? { reason } : {}) });
    };
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const bindings = clause?.namedBindings;
        const only = !!clause?.isTypeOnly || (!clause?.name && !!bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(e => e.isTypeOnly));
        record(node, node.moduleSpecifier.text, 'import', only);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const only = node.isTypeOnly || (!!node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(e => e.isTypeOnly));
        record(node, node.moduleSpecifier.text, 'export', only);
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        const expression = node.moduleReference.expression;
        record(node, expression && ts.isStringLiteral(expression) ? expression.text : null, 'require', node.isTypeOnly);
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        const argument = node.arguments[0];
        const literal = argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument));
        const shadowed = ts.isIdentifier(node.expression) && (checker.getSymbolAtLocation(node.expression)?.declarations?.length ?? 0) > 0;
        record(node, literal ? argument.text : null, node.expression.kind === ts.SyntaxKind.ImportKeyword ? 'dynamic-import' : 'require', false, shadowed ? 'Locally declared require: module loading cannot be inferred.' : undefined);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const sortedEdges = [...edges.values()].sort((a, b) => a.from.localeCompare(b.from, 'en') || a.id.localeCompare(b.id, 'en'));
  if (omittedReferences) diagnostics.push({ file: '(snapshot)', message: 'The 20,000 reference-occurrence budget was reached; later references were omitted.' });
  const count = (status: Edge['status']): number => sortedEdges.filter(edge => edge.status === status).length;
  return {
    sha, modules: sourcePaths.map(path => ({ path, hash: hash(files.get(path)!), bytes: Buffer.byteLength(files.get(path)!) })),
    edges: sortedEdges, diagnostics,
    coverage: { modules: sourcePaths.length, references: sortedEdges.length, internal: count('internal'), external: count('external'), unresolved: count('unresolved'), dynamic: count('dynamic'), parseErrors, skippedFiles: 0, omittedReferences },
  };
}
