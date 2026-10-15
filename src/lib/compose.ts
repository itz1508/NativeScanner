import { BUDGETS, COMPOSITION_HEADINGS, OUTCOME_LABEL } from './constants';
import { estimateTokens, formatBytes, unique } from './util';
import type {
  ArchiveDiff,
  ContentUnit,
  DuplicateGroup,
  Relationship,
  SourceNode,
  TerminalOutcome,
} from '../types';

export interface ComposeInput {
  intent: string;
  nodes: SourceNode[];
  duplicates: DuplicateGroup[];
  relationships: Relationship[];
  diffs: ArchiveDiff[];
  hintNotes: string[];
  coverageLimitations: string[];
  softTokenTarget: number;
  baselineNodeId?: string;
  generatedAt: Date;
}

export interface ComposeResult {
  markdown: string;
  finalOutcome: TerminalOutcome;
  outputBytes: number;
  outputTokens: number;
  trimmed: boolean;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had', 'her', 'was', 'one',
  'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see',
  'two', 'way', 'who', 'why', 'with', 'this', 'that', 'from', 'they', 'them', 'then', 'than', 'into',
  'when', 'what', 'which', 'while', 'where', 'about', 'should', 'would', 'could', 'have', 'been',
  'will', 'your', 'their', 'there', 'here', 'some', 'such', 'only', 'also', 'more', 'most', 'very',
  'just', 'each', 'both', 'does', 'did', 'does', 'use', 'using', 'used', 'make', 'made', 'need',
  'needs', 'want', 'like', 'file', 'files', 'content', 'source', 'sources',
]);

const RE_REQUIREMENT =
  /\b(must|shall|require|requires|required|mandatory|constraint|decision|accepted|rejected|deprecated|supersedes|superseded|always|never)\b|out of scope|not supported|non-goal|do not\b/i;

function intentTerms(intent: string): Set<string> {
  const terms = new Set<string>();
  for (const raw of intent.toLowerCase().split(/[^a-z0-9_+#.:-]+/)) {
    const term = raw.replace(/^[.:-]+|[.:-]+$/g, '');
    if (term.length >= 3 && !STOPWORDS.has(term)) terms.add(term);
  }
  return terms;
}

function scoreUnit(unit: ContentUnit, terms: Set<string>): number {
  if (terms.size === 0) return 0;
  const text = unit.text.toLowerCase();
  let score = 0;
  for (const term of terms) if (text.includes(term)) score += 1;
  return score;
}

function isReadable(node: SourceNode): boolean {
  return (
    (node.outcome === 'completed' || node.outcome === 'partial') && (Boolean(node.text) || Boolean(node.image))
  );
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  const limit = Math.min(offset, text.length);
  for (let i = 0; i < limit; i++) if (text[i] === '\n') line++;
  return line;
}

function unitReference(node: SourceNode, unit?: ContentUnit): string {
  const base = node.provenanceLabel;
  if (node.image) return `${base} (region)`;
  if (!unit || !node.text || (unit.start === 0 && unit.end === 0)) return base;
  const start = lineAt(node.text, unit.start);
  const end = lineAt(node.text, Math.max(unit.start, unit.end - 1));
  return start === end ? `${base}:L${start}` : `${base}:L${start}-L${end}`;
}

function hashPrefix(hash: string): string {
  return hash ? `${hash.slice(0, 12)}…` : '—';
}

/** Chooses a fence long enough to survive backticks inside the content. */
function fenced(text: string, info: string): string {
  let ticks = '```';
  while (text.includes(ticks)) ticks += '`';
  return `${ticks}${info}\n${text}\n${ticks}`;
}

function kindList(counts: Map<string, number>): string {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, n]) => `${n} ${label}`)
    .join(', ');
}

interface RequirementHit {
  node: SourceNode;
  text: string;
  key: string;
  reference: string;
}

function collectRequirements(nodes: SourceNode[]): RequirementHit[] {
  const hits: RequirementHit[] = [];
  for (const node of nodes) {
    if (!node.text) continue;
    const lines = node.text.split('\n');
    let offset = 0;
    for (const line of lines) {
      if (hits.length >= 60) break;
      const trimmed = line.trim();
      if (trimmed.length > 2 && trimmed.length < 400 && RE_REQUIREMENT.test(line)) {
        const words = trimmed
          .toLowerCase()
          .split(/[^a-z0-9_]+/)
          .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
          .slice(0, 3);
        hits.push({
          node,
          text: trimmed,
          key: words.sort().join(' ') || trimmed.slice(0, 40).toLowerCase(),
          reference: `${node.provenanceLabel}:L${lineAt(node.text, offset)}`,
        });
      }
      offset += line.length + 1;
    }
    if (hits.length >= 60) break;
  }
  return hits;
}

export function composeDocument(input: ComposeInput): ComposeResult {
  const { intent, nodes, duplicates, relationships, diffs, hintNotes, coverageLimitations } = input;
  const terms = intentTerms(intent);
  const readable = nodes.filter(isReadable);
  const contentNodes = readable.filter((n) => !n.duplicateOf);
  const degraded = nodes.filter((n) => n.outcome !== 'completed');
  const duplicatesById = new Map<string, DuplicateGroup>();
  for (const group of duplicates) for (const id of group.nodeIds) duplicatesById.set(id, group);

  const lines: string[] = [];

  /* ---------------------------------------------------------------- preamble */
  let finalOutcome: TerminalOutcome = 'completed';
  if (readable.length === 0 || degraded.length > 0) finalOutcome = 'partial';

  lines.push('# OneShot Context');
  lines.push('');
  lines.push(
    `> Generated ${input.generatedAt.toISOString()} · **${nodes.length}** source${
      nodes.length === 1 ? '' : 's'
    } inspected · **${readable.length}** contributed content · status: **${OUTCOME_LABEL[finalOutcome]}**`,
  );
  lines.push('');
  lines.push(
    'This file is a standalone consolidation. It was produced deterministically in the browser — no model, no vision and no network were used. Every claim below is either a measured fact about the supplied bytes or a verbatim excerpt, and every reference resolves to a source listed at the end.',
  );
  lines.push('');

  /* ------------------------------------------------------- current intent */
  lines.push(`## ${COMPOSITION_HEADINGS.intent}`);
  lines.push('');
  if (intent.trim()) {
    lines.push(intent.trim());
  } else {
    lines.push(
      '_No current intent was supplied. The consolidation is therefore organised by source order only, and intent-based ranking was skipped. Supplying the current question would let the generator prioritise the material that answers it._',
    );
  }
  lines.push('');

  /* ----------------------------------------------- consolidated understanding */
  const categoryCounts = new Map<string, number>();
  for (const node of nodes) {
    const label =
      node.kind === 'archive-zip' || node.kind === 'archive-tar' || node.kind === 'archive-tgz'
        ? 'archive(s)'
        : node.category === 'image'
          ? 'image(s)'
          : node.category === 'structured'
            ? 'structured-text source(s)'
            : node.category === 'text'
              ? 'text/code source(s)'
              : 'unrecognised source(s)';
    categoryCounts.set(label, (categoryCounts.get(label) ?? 0) + 1);
  }

  lines.push(`## ${COMPOSITION_HEADINGS.understanding}`);
  lines.push('');
  lines.push(`- Inputs inspected: ${kindList(categoryCounts)}.`);
  if (duplicates.length > 0) {
    lines.push(
      `- ${duplicates.length} set(s) of byte-identical sources were found and are included once, with all references kept.`,
    );
  }
  if (relationships.length > 0) {
    lines.push(`- ${relationships.length} relationship(s) between sources were detected (detailed below).`);
  }
  if (diffs.length > 0) {
    lines.push(`- ${diffs.length} archive-to-archive comparison(s) were computed.`);
  }
  if (degraded.length > 0) {
    lines.push(
      `- ${degraded.length} source(s) could not be read in full; each one is named with its reason in the coverage section.`,
    );
  } else if (nodes.length > 0) {
    lines.push('- Every source reached a terminal outcome with no unresolved limitations.');
  }
  lines.push('');

  /* --------------------------------------------------- verified current state */
  const topLevel = nodes.filter((n) => n.depth === 0);
  lines.push(`## ${COMPOSITION_HEADINGS.verified}`);
  lines.push('');
  lines.push('Measured facts about the supplied sources — not interpretations.');
  lines.push('');
  if (topLevel.length > 0) {
    lines.push('| Source | Kind | Size | SHA-256 | Outcome |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const node of topLevel) {
      lines.push(
        `| \`${node.provenanceLabel}\` | ${node.kind} | ${formatBytes(node.size)} | \`${hashPrefix(
          node.hash,
        )}\` | ${OUTCOME_LABEL[node.outcome]} |`,
      );
    }
  } else {
    lines.push('_No sources were registered, so there are no physical facts to report._');
  }
  lines.push('');

  /* ------------------------------------------- accepted decisions & constraints */
  const requirements = collectRequirements(readable);
  lines.push(`## ${COMPOSITION_HEADINGS.decisions}`);
  lines.push('');
  const decisionLines: string[] = [];
  if (input.baselineNodeId) {
    const baseline = nodes.find((n) => n.id === input.baselineNodeId);
    if (baseline) {
      decisionLines.push(
        `- **Baseline (user-selected):** \`${baseline.provenanceLabel}\`. This overrides filename- and version-number heuristics; conflicting evidence is still reported.`,
      );
    }
  }
  for (const note of hintNotes) decisionLines.push(`- **Stated relationship:** ${note}`);
  if (requirements.length > 0) {
    decisionLines.push('- Statements in the supplied content that read as decisions or constraints:');
    for (const hit of requirements) {
      decisionLines.push(`  - ${hit.text} — \`${hit.reference}\``);
    }
  }
  if (decisionLines.length === 0) {
    decisionLines.push(
      '- No baseline was set and no statement in the supplied content matched a decision/constraint pattern. Nothing is promoted to "accepted" without evidence.',
    );
  }
  lines.push(...decisionLines);
  lines.push('');

  /* ---------------------------------------------- relevant content (elastic) */
  const charBudget = Math.max(1200, Math.round(input.softTokenTarget * 4 * 1.6));
  const ranked = [...contentNodes].sort((a, b) => {
    const scoreOf = (node: SourceNode) => {
      const nameScore = Array.from(terms).filter((t) => node.name.toLowerCase().includes(t)).length * 2;
      const unitScore = (node.units ?? []).reduce((sum, u) => sum + scoreUnit(u, terms), 0);
      return nameScore + unitScore;
    };
    return scoreOf(b) - scoreOf(a) || a.provenanceLabel.localeCompare(b.provenanceLabel);
  });

  const includeMap = new Map<string, boolean[]>();
  let remaining = charBudget;
  let trimmed = false;
  for (let i = 0; i < ranked.length; i++) {
    const node = ranked[i];
    const units = node.units ?? [];
    const share = Math.max(600, Math.floor(remaining / Math.max(1, ranked.length - i)));
    let used = 0;
    const flags = units.map((unit) => {
      const cost = unit.text.length + 64;
      const structural = unit.kind === 'heading';
      if (used < share || structural) {
        used += cost;
        return true;
      }
      return false;
    });
    if (flags.some((f) => !f)) trimmed = true;
    includeMap.set(node.id, flags);
    remaining = Math.max(0, remaining - used);
  }

  lines.push(`## ${COMPOSITION_HEADINGS.content}`);
  lines.push('');
  if (contentNodes.length === 0) {
    lines.push(
      '_No readable content was extracted from any source. See the coverage and limitations section — this document makes no claim beyond what is listed there._',
    );
    lines.push('');
  }
  for (const node of contentNodes) {
    const group = duplicatesById.get(node.id);
    lines.push(`### ${node.provenanceLabel}`);
    lines.push('');
    const descriptors: string[] = [`\`${node.kind}\``, formatBytes(node.size), OUTCOME_LABEL[node.outcome]];
    if (node.truncated) descriptors.push('truncated');
    lines.push(`_${descriptors.join(' · ')}_`);
    lines.push('');

    if (node.image) {
      lines.push(
        `- Image dimensions: **${node.image.width}×${node.image.height}** (${node.image.format}). Content was **not interpreted** — no vision or OCR is available, so nothing is asserted about what the image depicts.`,
      );
      lines.push(`- Reference: \`${unitReference(node)}\``);
      lines.push('');
    }

    if (group && group.nodeIds.length > 1) {
      const others = group.labels.filter((label) => label !== node.provenanceLabel);
      lines.push(`- Also byte-identical to: ${others.map((l) => `\`${l}\``).join(', ')}.`);
      lines.push('');
    }

    const units = node.units ?? (node.text ? [{ kind: 'raw' as const, text: node.text, start: 0, end: node.text.length }] : []);
    const flags = includeMap.get(node.id) ?? units.map(() => true);
    let emitted = 0;
    units.forEach((unit, index) => {
      if (!flags[index]) return;
      emitted++;
      if (unit.kind === 'heading') {
        lines.push(`**${unit.label || unit.text.replace(/^#+\s*/, '')}** — \`${unitReference(node, unit)}\``);
        lines.push('');
        return;
      }
      lines.push(`*${unit.kind}* — \`${unitReference(node, unit)}\``);
      lines.push('');
      lines.push(fenced(unit.text, unit.kind === 'code' ? 'code' : unit.kind));
      lines.push('');
    });
    if (emitted < units.length) {
      trimmed = true;
      lines.push(
        `_${units.length - emitted} further passage(s) were omitted from the consolidated view to respect the soft token target. They remain in the original source._`,
      );
      lines.push('');
    }
    if (node.reason) {
      lines.push(`_Reader note: ${node.reason}_`);
      lines.push('');
    }
  }

  /* ------------------------------------------------- changes and relationships */
  lines.push(`## ${COMPOSITION_HEADINGS.changes}`);
  lines.push('');
  if (relationships.length === 0 && diffs.length === 0) {
    lines.push(
      '_No relationships between sources were detected: no shared byte hashes, no repeated file names and no comparable archives were present._',
    );
    lines.push('');
  }
  for (const relationship of relationships) {
    lines.push(`- ${relationship.detail}`);
  }
  if (relationships.length > 0) lines.push('');
  for (const diff of diffs) {
    const counts = new Map<string, number>();
    for (const entry of diff.entries) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
    lines.push(`### \`${diff.fromLabel}\` → \`${diff.toLabel}\``);
    lines.push('');
    lines.push(`Change counts: ${kindList(counts)}.`);
    lines.push('');
    lines.push('| Change | Path | Note |');
    lines.push('| --- | --- | --- |');
    for (const entry of diff.entries) {
      lines.push(`| ${entry.kind} | \`${entry.path}\` | ${entry.detail ?? ''} |`);
    }
    lines.push('');
  }

  /* -------------------------------------------------------- conflicts section */
  lines.push(`## ${COMPOSITION_HEADINGS.conflicts}`);
  lines.push('');
  const byKey = new Map<string, RequirementHit[]>();
  for (const hit of requirements) {
    const bucket = byKey.get(hit.key);
    if (bucket) bucket.push(hit);
    else byKey.set(hit.key, [hit]);
  }
  const conflicts = Array.from(byKey.values()).filter(
    (bucket) =>
      bucket.length > 1 &&
      new Set(bucket.map((h) => h.node.id)).size > 1 &&
      new Set(bucket.map((h) => h.text.toLowerCase())).size > 1,
  );
  if (conflicts.length > 0) {
    lines.push(
      'Statements that concern the same subject but differ across sources. **Both are retained** — this build never silently resolves a contradiction.',
    );
    lines.push('');
    for (const bucket of conflicts.slice(0, 20)) {
      lines.push(`- Subject \`${bucket[0].key}\`:`);
      for (const hit of bucket) lines.push(`  - ${hit.text} — \`${hit.reference}\``);
    }
  } else {
    lines.push(
      '_No structurally-detectable contradictions were found. This is a keyword-level structural check only, so treat it as a lower bound: absence here does not prove the sources agree. All source content is retained verbatim above, so nothing was discarded either way._',
    );
  }
  const unresolved = degraded.filter((n) => n.reason);
  if (unresolved.length > 0) {
    lines.push('');
    lines.push('Unresolved because a source could not be read:');
    for (const node of unresolved) {
      lines.push(`- \`${node.provenanceLabel}\` — ${node.reason}`);
    }
  }
  lines.push('');

  /* ----------------------------------------------------------- references table */
  lines.push(`## ${COMPOSITION_HEADINGS.sources}`);
  lines.push('');
  lines.push('| Reference | Kind | Size | Outcome | SHA-256 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const node of nodes) {
    lines.push(
      `| \`${node.provenanceLabel}\` | ${node.kind} | ${formatBytes(node.size)} | ${OUTCOME_LABEL[node.outcome]} | \`${hashPrefix(
        node.hash,
      )}\` |`,
    );
  }
  lines.push('');

  /* -------------------------------------------------------------- coverage */
  lines.push(`## ${COMPOSITION_HEADINGS.coverage}`);
  lines.push('');
  const outcomeCounts = new Map<string, number>();
  for (const node of nodes) {
    const label = OUTCOME_LABEL[node.outcome].toLowerCase();
    outcomeCounts.set(label, (outcomeCounts.get(label) ?? 0) + 1);
  }
  lines.push(`- Source outcomes: ${outcomeCounts.size > 0 ? kindList(outcomeCounts) : 'none'}.`);
  lines.push(
    `- Enforced budgets: per-file ≤ ${formatBytes(BUDGETS.maxFileBytes)}, per-member ≤ ${formatBytes(
      BUDGETS.maxMemberBytes,
    )}, total inflated ≤ ${formatBytes(BUDGETS.maxTotalInflatedBytes)}, member count ≤ ${
      BUDGETS.maxMemberCount
    }, nesting depth ≤ ${BUDGETS.maxDepth}, compression ratio ≤ ${BUDGETS.maxCompressionRatio}:1, per-archive ≤ ${
      BUDGETS.archiveWallMs / 1000
    }s, whole scan ≤ ${BUDGETS.totalScanMs / 1000}s.`,
  );
  lines.push(`- Retained-text cap per source: ${BUDGETS.maxRetainedChars} characters.`);
  lines.push(`- Soft output target: ~${input.softTokenTarget} tokens (meaning takes precedence over the number).`);
  if (trimmed) {
    lines.push(
      '- **Output was trimmed** in the "Relevant Content / Implementation" section to approach the soft token target. Nothing above the trim line was altered.',
    );
  }
  const limitSet = unique([...coverageLimitations, ...degraded.filter((n) => n.reason).map((n) => `${n.provenanceLabel}: ${n.reason}`)]);
  if (limitSet.length > 0) {
    lines.push('');
    lines.push('Limitations:');
    for (const limitation of limitSet) lines.push(`- ${limitation}`);
  } else {
    lines.push('');
    lines.push('- No limitations were recorded: every source was read within budget.');
  }
  lines.push('');

  const markdown = lines.join('\n');
  const outputBytes = new TextEncoder().encode(markdown).length;
  return {
    markdown,
    finalOutcome,
    outputBytes,
    outputTokens: estimateTokens(outputBytes),
    trimmed,
  };
}
