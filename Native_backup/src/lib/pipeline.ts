import { buildNodes, createArchiveCtx } from './archiveCore';
import type { ArchiveWorkerClient } from './archiveClient';
import { composeDocument } from './compose';
import { BUDGETS } from './constants';
import { correlate } from './correlate';
import { isArchiveKind, recognize } from './recognize';
import { estimateTokens, makeId, unique } from './util';
import type {
  CoverageRow,
  FormatKind,
  InputItem,
  ScanResult,
  SourceCategory,
  SourceNode,
  TerminalOutcome,
} from '../types';

export interface ScanRequest {
  intent: string;
  inputs: InputItem[];
  baselineId?: string;
  softTokenTarget: number;
}

export interface ScanProgress {
  stage: string;
  done: number;
  total: number;
}

export class ScanCancelledError extends Error {
  constructor() {
    super('Scan cancelled');
    this.name = 'ScanCancelledError';
  }
}

function manualNode(
  item: InputItem,
  overrides: {
    kind: FormatKind;
    category: SourceCategory;
    outcome: TerminalOutcome;
    reason?: string;
    size?: number;
    notes?: string[];
  },
): SourceNode {
  return {
    id: makeId('src'),
    name: item.name,
    originalFilename: item.name,
    kind: overrides.kind,
    category: overrides.category,
    size: overrides.size ?? item.size,
    hash: '',
    provenance: [item.name],
    provenanceLabel: item.name,
    outcome: overrides.outcome,
    reason: overrides.reason,
    depth: 0,
    origin: item.origin === 'paste' ? 'paste' : 'file',
    notes: overrides.notes ?? [],
    truncated: false,
  };
}

/** Picks a name with a sensible extension so pasted content is recognised. */
export function pasteFileName(text: string, fallback: string): string {
  const trimmed = text.trim();
  if (!trimmed) return `${fallback}.txt`;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return `${fallback}.json`;
    } catch {
      /* fall through */
    }
  }
  if (/^[\w.-]+\s*:\s*\S/m.test(trimmed)) return `${fallback}.yaml`;
  if (/^#{1,6}\s/m.test(trimmed)) return `${fallback}.md`;
  return `${fallback}.txt`;
}

export function createFileInput(file: File): InputItem {
  return {
    id: makeId('in'),
    origin: 'file',
    name: file.name,
    size: file.size,
    file,
    hint: '',
  };
}

export function createPasteInput(text: string, index: number): InputItem {
  return {
    id: makeId('in'),
    origin: 'paste',
    name: `Pasted block ${index}`,
    size: new TextEncoder().encode(text).length,
    pasteText: text,
    hint: '',
  };
}

async function nodesForInput(
  item: InputItem,
  archiveClient: ArchiveWorkerClient,
  deadline: number,
  ctx: ReturnType<typeof createArchiveCtx>,
): Promise<SourceNode[]> {
  if (item.origin === 'paste') {
    const text = item.pasteText ?? '';
    const bytes = new TextEncoder().encode(text);
    return buildNodes(bytes, pasteFileName(text, item.name), {
      depth: 0,
      origin: 'paste',
      provenance: [],
      ctx,
    });
  }

  const file = item.file;
  if (!file) {
    return [
      manualNode(item, {
        kind: 'unknown',
        category: 'unknown',
        outcome: 'failed',
        reason: 'The file handle was no longer available when the scan ran.',
      }),
    ];
  }

  if (file.size > BUDGETS.maxFileBytes) {
    return [
      manualNode(item, {
        kind: 'unknown',
        category: 'unknown',
        outcome: 'blocked',
        size: file.size,
        reason: `File is ${file.size} bytes, over the ${BUDGETS.maxFileBytes}-byte per-file budget.`,
      }),
    ];
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const recognition = recognize(bytes, file.name);

  if (isArchiveKind(recognition.kind)) {
    const archiveDeadline = Math.min(deadline, Date.now() + BUDGETS.archiveWallMs);
    const result = await archiveClient.scan(
      makeId('job'),
      file.name,
      recognition.kind,
      bytes,
      archiveDeadline,
    );
    for (const hit of result.budgetHits) ctx.budgetHits.push(hit);
    if (result.nodes.length === 0) {
      return [
        manualNode(item, {
          kind: recognition.kind,
          category: 'archive',
          outcome: 'failed',
          size: bytes.length,
          reason: result.error ?? 'The archive could not be read at all.',
        }),
      ];
    }
    return result.nodes;
  }

  return buildNodes(bytes, file.name, { depth: 0, origin: 'file', provenance: [], ctx });
}

function isUsable(node: SourceNode): boolean {
  return (
    (node.outcome === 'completed' || node.outcome === 'partial') && (Boolean(node.text) || Boolean(node.image))
  );
}

export async function runScan(
  request: ScanRequest,
  archiveClient: ArchiveWorkerClient,
  onProgress?: (progress: ScanProgress) => void,
  isCancelled: () => boolean = () => false,
): Promise<ScanResult> {
  const startedAt = Date.now();
  const deadline = startedAt + BUDGETS.totalScanMs;
  const ctx = createArchiveCtx(deadline);

  const nodes: SourceNode[] = [];
  const nodesByInput = new Map<string, string[]>();
  const limitations: string[] = [];
  let inputBytes = 0;
  let done = 0;

  for (const item of request.inputs) {
    if (isCancelled()) throw new ScanCancelledError();

    let produced: SourceNode[];
    if (Date.now() > deadline) {
      const node = manualNode(item, {
        kind: 'unknown',
        category: 'unknown',
        outcome: 'timed-out',
        reason: `The whole-scan budget of ${BUDGETS.totalScanMs / 1000}s elapsed before this source was read.`,
      });
      produced = [node];
    } else {
      try {
        produced = await nodesForInput(item, archiveClient, deadline, ctx);
      } catch (error) {
        if (error instanceof ScanCancelledError) throw error;
        produced = [
          manualNode(item, {
            kind: 'unknown',
            category: 'unknown',
            outcome: 'failed',
            reason: error instanceof Error ? error.message : 'Unexpected reader failure.',
          }),
        ];
      }
    }

    nodes.push(...produced);
    nodesByInput.set(
      item.id,
      produced.length > 0 ? [produced[0].id] : [],
    );
    inputBytes += item.size;
    done++;
    onProgress?.({ stage: `Read ${item.name}`, done, total: request.inputs.length });
  }

  if (isCancelled()) throw new ScanCancelledError();

  const baselineNodeId = request.baselineId ? nodesByInput.get(request.baselineId)?.[0] : undefined;
  const hints: Record<string, string> = {};
  for (const item of request.inputs) {
    if (!item.hint.trim()) continue;
    const rootId = nodesByInput.get(item.id)?.[0];
    if (rootId) hints[rootId] = item.hint;
  }

  onProgress?.({ stage: 'Correlating sources', done: request.inputs.length, total: request.inputs.length });
  const correlation = correlate(nodes, { baselineNodeId, hints });

  const readable = nodes.filter(isUsable);
  if (readable.length === 0) {
    limitations.push(
      'No usable sources: nothing readable was found in the supplied inputs, so this document makes no consolidation claim. Add a plain-text source, a supported file, or a readable archive member.',
    );
  }
  const hits = unique(ctx.budgetHits);
  if (hits.length > 0) {
    limitations.push(`Resource budgets were reached during processing: ${hits.join(', ')}.`);
  }

  onProgress?.({ stage: 'Composing document', done: request.inputs.length, total: request.inputs.length });
  const composed = composeDocument({
    intent: request.intent,
    nodes,
    duplicates: correlation.duplicates,
    relationships: correlation.relationships,
    diffs: correlation.diffs,
    hintNotes: correlation.hintNotes,
    coverageLimitations: limitations,
    softTokenTarget: request.softTokenTarget,
    baselineNodeId,
    generatedAt: new Date(),
  });

  const coverage: CoverageRow[] = nodes.map((node) => ({
    id: node.id,
    label: node.provenanceLabel,
    kind: node.kind,
    category: node.category,
    size: node.size,
    outcome: node.outcome,
    reason: node.reason,
    depth: node.depth,
    hash: node.hash,
  }));

  return {
    markdown: composed.markdown,
    nodes,
    inputRootIds: Object.fromEntries(
      Array.from(nodesByInput.entries())
        .map(([inputId, ids]) => [inputId, ids[0]] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
    ),
    duplicates: correlation.duplicates,
    relationships: correlation.relationships,
    diffs: correlation.diffs,
    coverage,
    limitations: unique([...limitations, ...nodes.filter((n) => n.reason).map((n) => `${n.provenanceLabel}: ${n.reason}`)]),
    budgetHits: hits,
    tokenEstimate: {
      inputBytes,
      outputBytes: composed.outputBytes,
      inputTokens: estimateTokens(inputBytes),
      outputTokens: composed.outputTokens,
    },
    finalOutcome: composed.finalOutcome,
    durationMs: Date.now() - startedAt,
    generatedAt: new Date().toISOString(),
  };
}
