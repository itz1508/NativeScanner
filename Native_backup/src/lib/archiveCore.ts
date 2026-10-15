import { Gunzip, Inflate } from 'fflate';
import { BUDGETS } from './constants';
import { sha256Hex } from './hash';
import { isArchiveKind, recognize } from './recognize';
import { readContent } from './readers';
import { parseTar } from './tar';
import { baseName, concatBytes, makeId, startsWithBytes } from './util';
import type {
  ContentUnit,
  FormatKind,
  ImageInfo,
  SourceCategory,
  SourceNode,
  SourceOrigin,
  TerminalOutcome,
} from '../types';

/**
 * Mutable budget accumulator shared across the whole recursion so nested
 * archives cannot each spend the full allowance.
 */
export interface ArchiveCtx {
  /** Absolute timestamp (ms) by which the scan must be finished. */
  deadline: number;
  memberCount: number;
  totalInflated: number;
  budgetHits: string[];
}

export function createArchiveCtx(deadline: number): ArchiveCtx {
  return { deadline, memberCount: 0, totalInflated: 0, budgetHits: [] };
}

export interface ArchiveScanResult {
  nodes: SourceNode[];
  outcome: TerminalOutcome;
  reason?: string;
}

interface RawMember {
  path: string;
  size: number;
  bytes: Uint8Array | null;
  outcome: TerminalOutcome;
  reason?: string;
}

interface ExtractCfg {
  maxMemberBytes: number;
  maxMemberCount: number;
  maxTotalInflated: number;
  maxRatio: number;
}

interface NodeInit {
  name: string;
  originalFilename: string;
  kind: FormatKind;
  category: SourceCategory;
  size: number;
  hash: string;
  provenance: string[];
  outcome: TerminalOutcome;
  reason?: string;
  depth: number;
  origin: SourceOrigin;
  parentId?: string;
  text?: string;
  units?: ContentUnit[];
  image?: ImageInfo;
  notes?: string[];
  truncated?: boolean;
}

function makeNode(init: NodeInit): SourceNode {
  return {
    id: makeId('src'),
    name: init.name,
    originalFilename: init.originalFilename,
    kind: init.kind,
    category: init.category,
    size: init.size,
    hash: init.hash,
    provenance: init.provenance,
    provenanceLabel: init.provenance.join(' :: '),
    outcome: init.outcome,
    reason: init.reason,
    depth: init.depth,
    origin: init.origin,
    parentId: init.parentId,
    text: init.text,
    units: init.units,
    image: init.image,
    notes: init.notes ?? [],
    truncated: init.truncated ?? false,
  };
}

/** Refuses traversal, absolute paths and NUL bytes; safe siblings still read. */
export function checkMemberPath(rawPath: string): { ok: true } | { ok: false; reason: string } {
  const path = rawPath.replace(/\\/g, '/');
  if (path.length === 0) return { ok: false, reason: 'member has an empty path' };
  if (path.includes('\0')) return { ok: false, reason: 'member path contains a NUL byte' };
  if (path.startsWith('/')) return { ok: false, reason: 'absolute member path — refused' };
  if (/^[a-zA-Z]:\//.test(path)) return { ok: false, reason: 'drive-qualified member path — refused' };
  for (const part of path.split('/')) {
    if (part === '..') return { ok: false, reason: 'path traversal ("..") — refused' };
  }
  return { ok: true };
}

/* --------------------------------------------------------------------- ZIP */

function extractZip(
  bytes: Uint8Array,
  ctx: ArchiveCtx,
  cfg: ExtractCfg,
): { members: RawMember[]; failure?: string } {
  const members: RawMember[] = [];
  let failure: string | undefined;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);

  unzip.onfile = (file) => {
    if (failure) return;
    const path = file.name;

    // Directory entries carry no content.
    if (path.endsWith('/')) {
      file.terminate();
      return;
    }

    if (ctx.memberCount >= cfg.maxMemberCount) {
      ctx.budgetHits.push('member-count');
      members.push({
        path,
        size: file.originalSize ?? 0,
        bytes: null,
        outcome: 'blocked',
        reason: `member count exceeded the limit of ${cfg.maxMemberCount}`,
      });
      file.terminate();
      return;
    }
    ctx.memberCount++;

    const safety = checkMemberPath(path);
    if (!safety.ok) {
      members.push({ path, size: file.originalSize ?? 0, bytes: null, outcome: 'blocked', reason: safety.reason });
      file.terminate();
      return;
    }

    const original = typeof file.originalSize === 'number' ? file.originalSize : undefined;
    const compressed = typeof file.size === 'number' ? file.size : undefined;

    // Size checks performed BEFORE start(): a refused member is never inflated.
    if (original !== undefined && original > cfg.maxMemberBytes) {
      ctx.budgetHits.push('member-bytes');
      members.push({
        path,
        size: original,
        bytes: null,
        outcome: 'blocked',
        reason: `member is ${original} bytes, over the ${cfg.maxMemberBytes}-byte per-member limit`,
      });
      file.terminate();
      return;
    }
    if (
      original !== undefined &&
      compressed !== undefined &&
      compressed > 0 &&
      original / compressed > cfg.maxRatio
    ) {
      ctx.budgetHits.push('ratio');
      members.push({
        path,
        size: original,
        bytes: null,
        outcome: 'blocked',
        reason: `compression ratio ${Math.round(original / compressed)}:1 exceeds the ${cfg.maxRatio}:1 limit`,
      });
      file.terminate();
      return;
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    let stopped = false;

    file.ondata = (err, chunk, final) => {
      if (stopped) return;
      if (err) {
        stopped = true;
        members.push({
          path,
          size: received,
          bytes: null,
          outcome: 'blocked',
          reason: `decompression error: ${err.message ?? 'unknown'}`,
        });
        return;
      }
      received += chunk.length;
      if (received > cfg.maxMemberBytes) {
        stopped = true;
        ctx.budgetHits.push('member-bytes');
        members.push({
          path,
          size: received,
          bytes: null,
          outcome: 'blocked',
          reason: `member exceeded the ${cfg.maxMemberBytes}-byte per-member limit while inflating`,
        });
        file.terminate();
        return;
      }
      if (ctx.totalInflated + received > cfg.maxTotalInflated) {
        stopped = true;
        ctx.budgetHits.push('total-inflated');
        members.push({
          path,
          size: received,
          bytes: null,
          outcome: 'blocked',
          reason: `total inflated bytes exceeded the ${cfg.maxTotalInflated}-byte budget`,
        });
        file.terminate();
        return;
      }
      chunks.push(chunk);
      if (final) {
        stopped = true;
        ctx.totalInflated += received;
        members.push({ path, size: received, bytes: concatBytes(chunks, received), outcome: 'completed' });
      }
    };

    try {
      file.start();
    } catch (error) {
      members.push({
        path,
        size: 0,
        bytes: null,
        outcome: 'blocked',
        reason: `unsupported compression method: ${error instanceof Error ? error.message : 'unknown'}`,
      });
    }
  };

  try {
    const CHUNK = 1 << 20;
    if (bytes.length === 0) {
      unzip.push(new Uint8Array(0), true);
    } else {
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        const end = Math.min(offset + CHUNK, bytes.length);
        unzip.push(bytes.subarray(offset, end), end >= bytes.length);
      }
    }
  } catch (error) {
    failure = `malformed or encrypted ZIP: ${error instanceof Error ? error.message : 'invalid archive'}`;
  }

  return { members, failure };
}

/* --------------------------------------------------------------------- TAR */

function extractTar(
  bytes: Uint8Array,
  ctx: ArchiveCtx,
  cfg: ExtractCfg,
): { members: RawMember[]; failure?: string; trailingReason?: string } {
  const remaining = Math.max(0, cfg.maxMemberCount - ctx.memberCount);
  const result = parseTar(bytes, { maxEntries: remaining });
  const members: RawMember[] = [];

  for (const entry of result.entries) {
    if (entry.outcome === 'blocked') {
      members.push({ path: entry.path, size: entry.size, bytes: null, outcome: 'blocked', reason: entry.reason });
      continue;
    }
    const safety = checkMemberPath(entry.path);
    if (!safety.ok) {
      members.push({ path: entry.path, size: entry.size, bytes: null, outcome: 'blocked', reason: safety.reason });
      continue;
    }
    if (ctx.memberCount >= cfg.maxMemberCount) {
      ctx.budgetHits.push('member-count');
      members.push({
        path: entry.path,
        size: entry.size,
        bytes: null,
        outcome: 'blocked',
        reason: `member count exceeded the limit of ${cfg.maxMemberCount}`,
      });
      continue;
    }
    if (entry.size > cfg.maxMemberBytes) {
      ctx.budgetHits.push('member-bytes');
      members.push({
        path: entry.path,
        size: entry.size,
        bytes: null,
        outcome: 'blocked',
        reason: `member is ${entry.size} bytes, over the ${cfg.maxMemberBytes}-byte per-member limit`,
      });
      continue;
    }
    if (ctx.totalInflated + entry.size > cfg.maxTotalInflated) {
      ctx.budgetHits.push('total-inflated');
      members.push({
        path: entry.path,
        size: entry.size,
        bytes: null,
        outcome: 'blocked',
        reason: `total inflated bytes exceeded the ${cfg.maxTotalInflated}-byte budget`,
      });
      continue;
    }
    ctx.memberCount++;
    ctx.totalInflated += entry.size;
    members.push({
      path: entry.path,
      size: entry.size,
      bytes: entry.data ?? new Uint8Array(0),
      outcome: 'completed',
    });
  }

  return {
    members,
    failure: result.truncated && result.entries.length === 0 ? (result.reason ?? 'TAR archive could not be read') : undefined,
    trailingReason:
      result.truncated && result.entries.length > 0
        ? (result.reason ?? 'TAR archive ended earlier than its header claimed')
        : undefined,
  };
}

/* -------------------------------------------------------------------- GZIP */

const BUDGET_ABORT = '__oneshot_budget_abort__';

function inflateGzip(
  bytes: Uint8Array,
  ctx: ArchiveCtx,
  maxBytes: number,
): { data: Uint8Array } | { error: string } {
  // Cheap pre-check on the GZIP trailer (ISIZE) before inflating anything.
  if (bytes.length >= 4) {
    const declared =
      bytes[bytes.length - 4] |
      (bytes[bytes.length - 3] << 8) |
      (bytes[bytes.length - 2] << 16) |
      (bytes[bytes.length - 1] << 24);
    if (declared > maxBytes) {
      ctx.budgetHits.push('total-inflated');
      return { error: `payload declares ${declared} bytes, over the ${maxBytes}-byte budget` };
    }
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  let exceeded: string | undefined;

  const gz = new Gunzip((chunk) => {
    if (exceeded) return;
    total += chunk.length;
    if (total > maxBytes) {
      exceeded = `inflated payload exceeded the ${maxBytes}-byte budget`;
      ctx.budgetHits.push('total-inflated');
      throw new Error(BUDGET_ABORT);
    }
    chunks.push(chunk);
  });

  try {
    gz.push(bytes, true);
  } catch (error) {
    if (exceeded) return { error: exceeded };
    const message = error instanceof Error ? error.message : 'invalid gzip stream';
    if (message === BUDGET_ABORT) return { error: exceeded ?? 'budget exceeded' };
    return { error: message };
  }

  return { data: concatBytes(chunks, total) };
}

/* ------------------------------------------------------------- node builder */

export interface NodeBuildContext {
  depth: number;
  parentId?: string;
  origin: SourceOrigin;
  provenance: string[];
  ctx: ArchiveCtx;
}

/**
 * Recognise a byte payload and turn it into one or more nodes. Archives recurse
 * (bounded by depth + shared budgets); everything else is read in place.
 */
export async function buildNodes(
  bytes: Uint8Array,
  name: string,
  context: NodeBuildContext,
): Promise<SourceNode[]> {
  const { ctx, provenance, depth, parentId, origin } = context;
  // `name` may be a full member path; the provenance keeps the whole path while
  // the display name stays the leaf file name.
  const displayName = baseName(name) || name;
  const recognition = recognize(bytes, name);
  const hash = await sha256Hex(bytes);
  const path = [...provenance, name];

  if (isArchiveKind(recognition.kind)) {
    if (depth >= BUDGETS.maxDepth) {
      return [
        makeNode({
          name: displayName,
          originalFilename: name,
          kind: recognition.kind,
          category: 'archive',
          size: bytes.length,
          hash,
          provenance: path,
          outcome: 'blocked',
          reason: `nesting depth exceeded the limit of ${BUDGETS.maxDepth}`,
          depth,
          origin,
          parentId,
          notes: [recognition.evidence],
        }),
      ];
    }
    const inner = await scanArchive(bytes, {
      name: displayName,
      kind: recognition.kind,
      provenance: path,
      depth: depth + 1,
      parentId: undefined,
      ctx,
    });
    const self = makeNode({
      name: displayName,
      originalFilename: name,
      kind: recognition.kind,
      category: 'archive',
      size: bytes.length,
      hash,
      provenance: path,
      outcome: inner.outcome,
      reason: inner.reason,
      depth,
      origin,
      parentId,
      notes: recognition.conflict ? [recognition.evidence] : [],
    });
    // Re-point members at this archive's id for a correct provenance tree.
    for (const child of inner.nodes) child.parentId = self.id;
    return [self, ...inner.nodes];
  }

  const read = readContent(bytes, recognition.kind);
  const notes = [...(recognition.conflict ? [recognition.evidence] : []), ...read.notes];
  return [
    makeNode({
      name: displayName,
      originalFilename: name,
      kind: recognition.kind,
      category: recognition.kind === 'unknown' ? 'unknown' : recognition.category,
      size: bytes.length,
      hash,
      provenance: path,
      outcome: read.outcome,
      reason: read.reason,
      depth,
      origin,
      parentId,
      text: read.text,
      units: read.units,
      image: read.image,
      notes,
      truncated: read.truncated,
    }),
  ];
}

/* -------------------------------------------------------------- archive scan */

export interface ArchiveScanOptions {
  name: string;
  kind: FormatKind;
  provenance: string[];
  depth: number;
  parentId?: string;
  ctx: ArchiveCtx;
}

export async function scanArchive(bytes: Uint8Array, options: ArchiveScanOptions): Promise<ArchiveScanResult> {
  const { kind, provenance, depth, ctx } = options;
  const nodes: SourceNode[] = [];

  if (Date.now() > ctx.deadline) {
    ctx.budgetHits.push('archive-wall-clock');
    return {
      nodes,
      outcome: 'timed-out',
      reason: `archive scan exceeded the ${BUDGETS.archiveWallMs} ms wall-clock budget`,
    };
  }

  const cfg: ExtractCfg = {
    maxMemberBytes: BUDGETS.maxMemberBytes,
    maxMemberCount: BUDGETS.maxMemberCount,
    maxTotalInflated: BUDGETS.maxTotalInflatedBytes,
    maxRatio: BUDGETS.maxCompressionRatio,
  };

  let members: RawMember[] = [];
  let failure: string | undefined;
  let trailingReason: string | undefined;

  if (kind === 'archive-zip') {
    const result = extractZip(bytes, ctx, cfg);
    members = result.members;
    failure = result.failure;
  } else if (kind === 'archive-tar') {
    const result = extractTar(bytes, ctx, cfg);
    members = result.members;
    failure = result.failure;
    trailingReason = result.trailingReason;
  } else {
    const inflated = inflateGzip(bytes, ctx, cfg.maxTotalInflated);
    if ('error' in inflated) {
      return { nodes, outcome: 'failed', reason: `GZIP inflation failed: ${inflated.error}` };
    }
    const innerName = options.name.replace(/\.(tgz|tar\.gz|gz)$/i, '');
    const innerRecognition = recognize(inflated.data, innerName || options.name);
    if (innerRecognition.kind === 'archive-tar') {
      const result = extractTar(inflated.data, ctx, cfg);
      members = result.members;
      failure = result.failure;
      trailingReason = result.trailingReason;
    } else if (innerRecognition.kind === 'archive-zip') {
      const result = extractZip(inflated.data, ctx, cfg);
      members = result.members;
      failure = result.failure;
    } else {
      return {
        nodes,
        outcome: 'unsupported',
        reason: 'GZIP payload is not a TAR or ZIP archive, so it was not interpreted as one.',
      };
    }
  }

  if (failure) {
    return {
      nodes,
      outcome: members.length > 0 ? 'partial' : 'failed',
      reason: failure,
    };
  }

  for (const member of members) {
    if (member.bytes === null) {
      nodes.push(
        makeNode({
          name: baseName(member.path) || member.path,
          originalFilename: member.path,
          kind: 'unknown',
          category: 'unknown',
          size: member.size,
          hash: '',
          provenance: [...provenance, member.path],
          outcome: member.outcome,
          reason: member.reason,
          depth,
          origin: 'member',
          parentId: options.parentId,
        }),
      );
      continue;
    }
    const built = await buildNodes(member.bytes, member.path, {
      depth,
      parentId: options.parentId,
      origin: 'member',
      provenance,
      ctx,
    });
    nodes.push(...built);
  }

  const emptyZip = startsWithBytes(bytes, [0x50, 0x4b, 0x05, 0x06]);
  if (members.length === 0 && kind !== 'archive-tgz') {
    if (emptyZip || bytes.length === 0) {
      return { nodes, outcome: 'completed', reason: undefined };
    }
    return {
      nodes,
      outcome: 'unsupported',
      reason: 'no readable members were found — the archive may be corrupt, encrypted or empty in an unusual way.',
    };
  }

  const budgetHit = ctx.budgetHits.length > 0;
  const degradedMembers = nodes.filter((n) => n.outcome !== 'completed').length;
  const timedOut = Date.now() > ctx.deadline;

  let outcome: TerminalOutcome = 'completed';
  let reason: string | undefined;

  if (timedOut) {
    outcome = 'timed-out';
    reason = `archive scan exceeded the ${BUDGETS.archiveWallMs} ms wall-clock budget`;
    ctx.budgetHits.push('archive-wall-clock');
  } else if (degradedMembers > 0) {
    outcome = 'partial';
    reason = `${degradedMembers} of ${nodes.length} member${nodes.length === 1 ? '' : 's'} could not be fully read; the rest were processed.`;
  } else if (trailingReason) {
    outcome = 'partial';
    reason = trailingReason;
  } else if (budgetHit) {
    outcome = 'partial';
    reason = 'a resource budget was reached while reading this archive.';
  }

  return { nodes, outcome, reason };
}
