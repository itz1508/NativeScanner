import type { TerminalOutcome } from '../types';

/**
 * Hard resource budgets. Untrusted input must never hang, OOM or block the UI —
 * every limit here is enforced (and surfaced) rather than merely advisory.
 */
export const BUDGETS = {
  /** Maximum size of a single input file. */
  maxFileBytes: 25 * 1024 * 1024,
  /** Maximum inflated size of a single archive member. */
  maxMemberBytes: 5 * 1024 * 1024,
  /** Maximum total inflated bytes across one archive. */
  maxTotalInflatedBytes: 100 * 1024 * 1024,
  /** Maximum number of members processed from one archive. */
  maxMemberCount: 2000,
  /** Maximum nesting depth for archives within archives. */
  maxDepth: 4,
  /** Maximum accepted decompression ratio. */
  maxCompressionRatio: 100,
  /** Wall-clock budget for a single archive. */
  archiveWallMs: 20_000,
  /** Wall-clock budget for an entire scan. */
  totalScanMs: 60_000,
  /** Maximum characters of decoded text retained per source. */
  maxRetainedChars: 400_000,
} as const;

export const DEFAULT_SOFT_TOKEN_TARGET = 2000;

export const TERMINAL_OUTCOMES: TerminalOutcome[] = [
  'completed',
  'partial',
  'blocked',
  'unsupported',
  'timed-out',
  'failed',
];

export const OUTCOME_LABEL: Record<TerminalOutcome, string> = {
  completed: 'Completed',
  partial: 'Partial',
  blocked: 'Blocked',
  unsupported: 'Unsupported',
  'timed-out': 'Timed out',
  failed: 'Failed',
};

/** The outcome is "clean" only when it is exactly this. */
export const CLEAN_OUTCOME: TerminalOutcome = 'completed';

export const CATEGORY_LABEL: Record<string, string> = {
  text: 'Text',
  structured: 'Structured',
  image: 'Image',
  archive: 'Archive',
  unknown: 'Unknown',
};

/**
 * Composition headings. They are adaptable: omit the irrelevant ones, but never
 * fabricate a section that has no content.
 */
export const COMPOSITION_HEADINGS = {
  intent: 'Current User Intent',
  understanding: 'Consolidated Understanding',
  verified: 'Verified Current State',
  decisions: 'Accepted Decisions and Constraints',
  content: 'Relevant Content / Implementation',
  changes: 'Changes and Relationships',
  conflicts: 'Conflicts and Unresolved Questions',
  sources: 'Sources and Evidence References',
  coverage: 'Inspection Coverage and Limitations',
} as const;
