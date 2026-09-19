import type { AtlasReport, ImpactPath, Snapshot } from './model.js';

function adjacency(snapshot: Snapshot, reverse = false): Map<string, string[]> {
  const graph = new Map(snapshot.modules.map(module => [module.path, [] as string[]]));
  for (const edge of snapshot.edges) {
    if (edge.status !== 'internal' || !edge.to) continue;
    const from = reverse ? edge.to : edge.from, to = reverse ? edge.from : edge.to;
    if (!graph.get(from)?.includes(to)) graph.get(from)?.push(to);
  }
  for (const values of graph.values()) values.sort();
  return graph;
}

export function cycles(snapshot: Snapshot): string[][] {
  const graph = adjacency(snapshot), reverse = adjacency(snapshot, true);
  const visited = new Set<string>(), order: string[] = [];
  for (const start of graph.keys()) {
    if (visited.has(start)) continue;
    const stack: [string, boolean][] = [[start, false]];
    while (stack.length) {
      const [node, done] = stack.pop()!;
      if (done) { order.push(node); continue; }
      if (visited.has(node)) continue;
      visited.add(node); stack.push([node, true]);
      for (const child of graph.get(node) ?? []) if (!visited.has(child)) stack.push([child, false]);
    }
  }
  visited.clear();
  const components: string[][] = [];
  for (const start of order.reverse()) {
    if (visited.has(start)) continue;
    const component: string[] = [], stack = [start];
    visited.add(start);
    while (stack.length) {
      const node = stack.pop()!; component.push(node);
      for (const child of reverse.get(node) ?? []) if (!visited.has(child)) { visited.add(child); stack.push(child); }
    }
    component.sort();
    if (component.length > 1 || graph.get(start)?.includes(start)) components.push(component);
  }
  return components.sort((a, b) => a.join('\0').localeCompare(b.join('\0'), 'en'));
}

/** One deterministic shortest reverse-dependency path per potential dependent. */
export function upstreamPaths(snapshot: Snapshot, target: string, maxDepth = 8): ImpactPath[] {
  if (!Number.isInteger(maxDepth) || maxDepth < 0) throw new Error('maxDepth must be a nonnegative integer');
  const reverse = adjacency(snapshot, true);
  if (!reverse.has(target)) return [];
  const seen = new Set([target]), queue: string[][] = [[target]], result: ImpactPath[] = [];
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index]!;
    if (path.length - 1 >= maxDepth) continue;
    for (const parent of reverse.get(path[path.length - 1]!) ?? []) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      const next = [...path, parent]; queue.push(next);
      result.push({ module: parent, path: [...next].reverse() });
    }
  }
  return result;
}

export function compareSnapshots(base: Snapshot, head: Snapshot): AtlasReport {
  const before = new Map(base.modules.map(module => [module.path, module]));
  const after = new Map(head.modules.map(module => [module.path, module]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes: AtlasReport['changes'] = [];
  for (const path of paths) {
    if (!before.has(path)) changes.push({ path, kind: 'added' });
    else if (!after.has(path)) changes.push({ path, kind: 'removed' });
    else if (before.get(path)!.hash !== after.get(path)!.hash) changes.push({ path, kind: 'modified' });
  }
  const baseEdges = new Set(base.edges.map(edge => edge.id)), headEdges = new Set(head.edges.map(edge => edge.id));
  const oldCycles = new Set(cycles(base).map(group => JSON.stringify(group)));
  return {
    schemaVersion: 1, base, head, changes,
    addedEdges: head.edges.filter(edge => !baseEdges.has(edge.id)),
    removedEdges: base.edges.filter(edge => !headEdges.has(edge.id)),
    newCycles: cycles(head).filter(group => !oldCycles.has(JSON.stringify(group))),
  };
}
