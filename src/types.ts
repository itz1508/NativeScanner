/**
 * Domain model for OneShot — the browser-side multi-source context consolidator.
 *
 * Everything here is deterministic and structural: there is no model, no vision
 * and no backend. Types describe a single Scan (one current question/intent plus
 * many mixed sources) and the single Markdown artifact it produces.
 */

/** The fixed set of terminal outcomes every source must resolve to. */
export type TerminalOutcome =
  | 'completed'
  | 'partial'
  | 'blocked'
  | 'unsupported'
  | 'timed-out'
  | 'failed';

/** Broad handling category, derived from recognition. */
export type SourceCategory = 'text' | 'structured' | 'image' | 'archive' | 'unknown';

/** Fine-grained recognised format. */
export type FormatKind =
  | 'text'
  | 'markdown'
  | 'code'
  | 'log'
  | 'json'
  | 'yaml'
  | 'toml'
  | 'xml'
  | 'csv'
  | 'image-png'
  | 'image-jpeg'
  | 'image-webp'
  | 'archive-zip'
  | 'archive-tar'
  | 'archive-tgz'
  | 'unknown';

/** A bounded, structure-preserving slice of readable content. */
export type UnitKind =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'table'
  | 'code'
  | 'conditional'
  | 'diff'
  | 'stack'
  | 'message'
  | 'keyvalue'
  | 'raw';

export interface ContentUnit {
  kind: UnitKind;
  text: string;
  start: number;
  end: number;
  /** e.g. heading text, `if`/`else` label, JSON path, diff header. */
  label?: string;
  note?: string;
}

export interface ImageInfo {
  format: string;
  width: number;
  height: number;
}

export type SourceOrigin = 'paste' | 'file' | 'member';

/**
 * A single registered source. Top-level files/pastes and every archive member
 * (including members of nested archives) are all SourceNodes.
 */
export interface SourceNode {
  id: string;
  /** Leaf file name. */
  name: string;
  originalFilename: string;
  kind: FormatKind;
  category: SourceCategory;
  /** Inflated/decode size in bytes. */
  size: number;
  /** SHA-256 of the source bytes (hex). */
  hash: string;
  /** Path chain, e.g. ['archive-A.zip', 'nested/docs/spec.md']. */
  provenance: string[];
  /** Rendered provenance, e.g. 'archive-A.zip :: nested/docs/spec.md'. */
  provenanceLabel: string;
  outcome: TerminalOutcome;
  /** Human-readable explanation when outcome is not 'completed'. */
  reason?: string;
  depth: number;
  origin: SourceOrigin;
  parentId?: string;
  /** Retained (bounded) decoded text. */
  text?: string;
  units?: ContentUnit[];
  image?: ImageInfo;
  notes: string[];
  /** True when text was capped at the retained-char budget. */
  truncated: boolean;
  /** Set when this node's bytes duplicate another node's. */
  duplicateOf?: string;
}

export interface DuplicateGroup {
  hash: string;
  nodeIds: string[];
  labels: string[];
}

export type RelationshipKind =
  | 'same-name-different-provenance'
  | 'shared-path'
  | 'version-hint'
  | 'baseline-override'
  | 'manifest-mention';

export interface Relationship {
  kind: RelationshipKind;
  nodeIds: string[];
  detail: string;
}

export type ChangeKind = 'added' | 'removed' | 'modified' | 'unchanged' | 'moved';

export interface ChangeEntry {
  kind: ChangeKind;
  path: string;
  detail?: string;
}

export interface ArchiveDiff {
  fromNodeId: string;
  toNodeId: string;
  fromLabel: string;
  toLabel: string;
  entries: ChangeEntry[];
}

export interface CoverageRow {
  id: string;
  label: string;
  kind: FormatKind;
  category: SourceCategory;
  size: number;
  outcome: TerminalOutcome;
  reason?: string;
  depth: number;
  hash: string;
}

export interface TokenEstimate {
  inputBytes: number;
  outputBytes: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ScanResult {
  markdown: string;
  nodes: SourceNode[];
  /** inputId → root node id, so the registry can show an outcome per input. */
  inputRootIds: Record<string, string>;
  duplicates: DuplicateGroup[];
  relationships: Relationship[];
  diffs: ArchiveDiff[];
  coverage: CoverageRow[];
  limitations: string[];
  budgetHits: string[];
  tokenEstimate: TokenEstimate;
  finalOutcome: TerminalOutcome;
  durationMs: number;
  generatedAt: string;
}

/** A user-registered input (before or during a scan). */
export interface InputItem {
  id: string;
  origin: 'paste' | 'file';
  name: string;
  size: number;
  file?: File;
  pasteText?: string;
  /** Optional relationship hint the user typed against this input. */
  hint: string;
}

export interface ScanSettings {
  intent: string;
  inputs: InputItem[];
  baselineId?: string;
  softTokenTarget: number;
}

/** Severity used by the UI for outcome chips. */
export type OutcomeTone = 'ok' | 'warn' | 'bad' | 'neutral';
