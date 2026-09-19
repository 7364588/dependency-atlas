export type EdgeKind = 'import' | 'export' | 'require' | 'dynamic-import';
export type EdgeStatus = 'internal' | 'external' | 'unresolved' | 'dynamic';
export interface Evidence { file: string; line: number; column: number; text: string; truncated: boolean }
export interface Edge {
  id: string; from: string; to: string | null; specifier: string | null;
  kind: EdgeKind; status: EdgeStatus; typeOnly: boolean; evidence: Evidence[]; reason?: string;
}
export interface Module { path: string; hash: string; bytes: number }
export interface Diagnostic { file: string; message: string; line?: number }
export interface Coverage {
  modules: number; references: number; internal: number; external: number;
  unresolved: number; dynamic: number; parseErrors: number; skippedFiles: number; omittedReferences: number;
}
export interface Snapshot {
  sha: string; modules: Module[]; edges: Edge[]; coverage: Coverage;
  diagnostics: Diagnostic[];
}
export interface ModuleChange { path: string; kind: 'added' | 'removed' | 'modified' }
export interface AtlasReport {
  schemaVersion: 1; base: Snapshot; head: Snapshot;
  changes: ModuleChange[]; addedEdges: Edge[]; removedEdges: Edge[];
  newCycles: string[][];
}
export interface ImpactPath { module: string; path: string[] }
