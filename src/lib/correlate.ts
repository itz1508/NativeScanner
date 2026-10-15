import { baseName, extOf } from './util';
import type {
  ArchiveDiff,
  ChangeEntry,
  DuplicateGroup,
  Relationship,
  SourceNode,
} from '../types';

export interface CorrelationResult {
  duplicates: DuplicateGroup[];
  relationships: Relationship[];
  diffs: ArchiveDiff[];
  /** Node ids that carry content in the consolidated document (one per duplicate set). */
  representatives: Set<string>;
  /** Human-readable notes from the user's own relationship hints. */
  hintNotes: string[];
}

const MAX_DIFF_ENTRIES = 200;

function versionTokens(name: string): string[] {
  const matches = name.match(/\d+(?:[._-]\d+)*/g);
  return matches ?? [];
}

function stemOf(name: string): string {
  const base = baseName(name).toLowerCase();
  const ext = extOf(base);
  const withoutExt = ext ? base.slice(0, -ext.length) : base;
  return withoutExt.replace(/[\d._-]+$/g, '').replace(/[-_]+/g, '-');
}

function isTopLevelArchive(node: SourceNode): boolean {
  return node.category === 'archive' && node.depth === 0;
}

function memberKey(node: SourceNode): string | null {
  if (node.origin !== 'member') return null;
  const parts = node.provenance.slice();
  parts.pop();
  return node.provenance.join('/');
}

/**
 * Deterministic correlation. No model is involved: relationships come from byte
 * hashes, file names, provenance paths and manifest text. Contradictions are
 * preserved rather than resolved, and omission is never treated as rejection.
 */
export function correlate(
  nodes: SourceNode[],
  options: { baselineNodeId?: string; hints: Record<string, string> },
): CorrelationResult {
  const duplicates: DuplicateGroup[] = [];
  const relationships: Relationship[] = [];
  const diffs: ArchiveDiff[] = [];
  const representatives = new Set<string>();
  const hintNotes: string[] = [];

  /* ---------------------------------------------------- exact byte duplicates */
  const byHash = new Map<string, SourceNode[]>();
  for (const node of nodes) {
    if (!node.hash) continue;
    const bucket = byHash.get(node.hash);
    if (bucket) bucket.push(node);
    else byHash.set(node.hash, [node]);
  }

  for (const [hash, group] of byHash) {
    if (group.length < 2) {
      representatives.add(group[0].id);
      continue;
    }
    const representative = group[0];
    representatives.add(representative.id);
    duplicates.push({
      hash,
      nodeIds: group.map((n) => n.id),
      labels: group.map((n) => n.provenanceLabel),
    });
    for (const node of group.slice(1)) node.duplicateOf = representative.id;
    relationships.push({
      kind: 'manifest-mention',
      nodeIds: group.map((n) => n.id),
      detail: `${group.length} sources share identical bytes (SHA-256 ${hash.slice(0, 12)}…) — content is included once with all references.`,
    });
  }

  /* ---------------------------------- same name, different origin and content */
  const byName = new Map<string, SourceNode[]>();
  for (const node of nodes) {
    const key = baseName(node.name).toLowerCase();
    const bucket = byName.get(key);
    if (bucket) bucket.push(node);
    else byName.set(key, [node]);
  }

  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    const hashes = new Set(group.map((n) => n.hash).filter(Boolean));
    if (hashes.size <= 1) continue;
    relationships.push({
      kind: 'same-name-different-provenance',
      nodeIds: group.map((n) => n.id),
      detail: `${group.length} sources are named "${name}" but differ in content. They are kept as distinct sources — a shared file name is never treated as an identity.`,
    });
    const tokens = new Set(group.flatMap((n) => versionTokens(n.name)));
    if (tokens.size > 1) {
      relationships.push({
        kind: 'version-hint',
        nodeIds: group.map((n) => n.id),
        detail: `Version-like tokens found in the names: ${Array.from(tokens).join(', ')}. Version numbers are hints only — authority is not inferred from them.`,
      });
    }
  }

  /* --------------------------------------------- repeated paths across archives */
  const byMemberPath = new Map<string, SourceNode[]>();
  for (const node of nodes) {
    const key = memberKey(node);
    if (!key) continue;
    const bucket = byMemberPath.get(key);
    if (bucket) bucket.push(node);
    else byMemberPath.set(key, [node]);
  }
  for (const [path, group] of byMemberPath) {
    if (group.length < 2) continue;
    const parents = new Set(group.map((n) => n.parentId ?? 'root'));
    if (parents.size < 2) continue;
    relationships.push({
      kind: 'shared-path',
      nodeIds: group.map((n) => n.id),
      detail: `Path "${path}" appears in ${parents.size} different archives; each copy is retained separately.`,
    });
  }

  /* ------------------------------------------------------------- baseline note */
  if (options.baselineNodeId) {
    const baseline = nodes.find((n) => n.id === options.baselineNodeId);
    if (baseline) {
      const sameStem = nodes.filter((n) => n.id !== baseline.id && stemOf(n.name) === stemOf(baseline.name));
      relationships.push({
        kind: 'baseline-override',
        nodeIds: [baseline.id, ...sameStem.map((n) => n.id)],
        detail:
          sameStem.length > 0
            ? `You marked "${baseline.provenanceLabel}" as the baseline. Filename/version heuristics would have suggested ${sameStem
                .map((n) => `"${n.name}"`)
                .join(', ')} — the baseline takes precedence, and the conflicting evidence is still reported below.`
            : `You marked "${baseline.provenanceLabel}" as the baseline. It takes precedence over filename or version-number heuristics.`,
      });
    }
  }

  /* ------------------------------------------- user relationship hints → notes */
  for (const [nodeId, hint] of Object.entries(options.hints)) {
    if (!hint.trim()) continue;
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) continue;
    hintNotes.push(`About "${node.name}": ${hint.trim()}`);
  }

  /* -------------------------------------------------- archive delta comparison */
  const archives = nodes.filter(isTopLevelArchive);
  for (let i = 0; i < archives.length; i++) {
    for (let j = i + 1; j < archives.length; j++) {
      const a = archives[i];
      const b = archives[j];
      const membersOf = (archive: SourceNode) =>
        nodes.filter((n) => n.parentId === archive.id).map((n) => ({ node: n, key: memberKey(n) ?? n.name }));
      const memberA = membersOf(a);
      const memberB = membersOf(b);
      if (memberA.length === 0 && memberB.length === 0) continue;
      const keysA = new Set(memberA.map((m) => m.key));
      const shared = memberB.filter((m) => keysA.has(m.key));
      if (shared.length === 0 && stemOf(a.name) !== stemOf(b.name)) continue;

      const mapA = new Map(memberA.map((m) => [m.key, m.node]));
      const mapB = new Map(memberB.map((m) => [m.key, m.node]));
      const entries: ChangeEntry[] = [];
      const hashesInA = new Map(memberA.filter((m) => m.node.hash).map((m) => [m.node.hash, m.key]));
      const hashesInB = new Map(memberB.filter((m) => m.node.hash).map((m) => [m.node.hash, m.key]));

      for (const [key, node] of mapA) {
        if (entries.length >= MAX_DIFF_ENTRIES) break;
        if (mapB.has(key)) {
          const other = mapB.get(key)!;
          if (node.hash && other.hash && node.hash === other.hash) {
            entries.push({ kind: 'unchanged', path: key });
          } else {
            entries.push({ kind: 'modified', path: key, detail: 'same path, different bytes' });
          }
        } else if (node.hash && hashesInB.has(node.hash)) {
          entries.push({ kind: 'moved', path: key, detail: `now at ${hashesInB.get(node.hash)}` });
        } else {
          entries.push({ kind: 'removed', path: key, detail: 'present only in the earlier archive' });
        }
      }
      for (const [key, node] of mapB) {
        if (entries.length >= MAX_DIFF_ENTRIES) break;
        if (!mapA.has(key)) {
          if (node.hash && hashesInA.has(node.hash)) {
            entries.push({ kind: 'moved', path: key, detail: `was at ${hashesInA.get(node.hash)}` });
          } else {
            entries.push({ kind: 'added', path: key, detail: 'present only in the later archive' });
          }
        }
      }

      if (entries.length > 0) {
        diffs.push({
          fromNodeId: a.id,
          toNodeId: b.id,
          fromLabel: a.provenanceLabel,
          toLabel: b.provenanceLabel,
          entries,
        });
      }
    }
  }

  return { duplicates, relationships, diffs, representatives, hintNotes };
}
