import { BUDGETS } from './constants';
import type { ContentUnit, FormatKind, ImageInfo, TerminalOutcome } from '../types';

export interface ReadResult {
  outcome: TerminalOutcome;
  reason?: string;
  text?: string;
  units?: ContentUnit[];
  image?: ImageInfo;
  notes: string[];
  truncated: boolean;
}

/* ------------------------------------------------------------------ decoding */

function decodeUtf8(bytes: Uint8Array): { text: string; fatal: boolean } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), fatal: true };
  } catch {
    // Lossy fallback — retained only as a clearly-marked preview.
    return { text: new TextDecoder('utf-8', { fatal: false }).decode(bytes), fatal: false };
  }
}

/* -------------------------------------------------------------- segmentation */

interface Line {
  text: string;
  start: number;
  end: number;
}

function splitLines(text: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      out.push({ text: text.slice(start, i), start, end: i + 1 });
      start = i + 1;
    }
  }
  out.push({ text: text.slice(start), start, end: text.length });
  return out;
}

const RE_HEADING = /^#{1,6}(\s|$)/;
const RE_FENCE = /^\s*(`{3,}|~{3,})/;
const RE_CONDITIONAL =
  /^\s*(?:#\s*(?:if|ifdef|ifndef|else|elif|endif)\b|\{\{\s*[#/]?\s*(?:if|else|endif)\b|\/\/\s*#\s*(?:if|else|endif)\b)/;
const RE_DIFF = /^(diff --git |@@ |\+\+\+ |--- a\/|Index: )/;
const RE_STACK = /^\s+(?:at\s+\S|File ".*", line \d+|\.\.\.\s*\d+ more)|^Traceback \(most recent call last\)|^\s*Caused by:/;
const RE_MESSAGE = /^\s*(?:user|assistant|human|system|prompt|response|q|a)\s*:\s*\S/i;
const RE_LIST = /^\s*(?:[-*+]|\d+[.)])\s+\S/;
const RE_KEYVALUE = /^\s*(?:["']?[\w.$-]+["']?)\s*[:=]\s*\S/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function countPipes(line: string): number {
  let n = 0;
  for (let i = 0; i < line.length; i++) if (line[i] === '|') n++;
  return n;
}

/**
 * Bounded structural segmentation. It follows each format's visible syntax
 * (fences, headings, preprocessor branches, diff hunks, stack frames, tables)
 * while keeping the raw text and byte offsets. Anything it cannot classify is
 * preserved verbatim as a paragraph — never dropped.
 */
export function segment(text: string, kind: FormatKind): ContentUnit[] {
  if (kind === 'json') return segmentJson(text);

  const lines = splitLines(text);
  const units: ContentUnit[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line.text)) {
      i++;
      continue;
    }

    const fence = RE_FENCE.exec(line.text);
    if (fence) {
      const marker = fence[1][0];
      const start = line.start;
      let j = i + 1;
      while (j < lines.length && !new RegExp(`^\\s*\\${marker}{3,}`).test(lines[j].text)) j++;
      const end = j < lines.length ? lines[j].end : lines[lines.length - 1].end;
      const info = line.text.replace(/^\s*[`~]{3,}/, '').trim();
      units.push({
        kind: 'code',
        text: text.slice(start, end),
        start,
        end,
        label: info || 'code',
      });
      i = j + 1;
      continue;
    }

    if (RE_HEADING.test(line.text)) {
      units.push({
        kind: 'heading',
        text: line.text,
        start: line.start,
        end: line.end,
        label: line.text.replace(/^#+\s*/, '').trim(),
      });
      i++;
      continue;
    }

    const conditional = RE_CONDITIONAL.exec(line.text);
    if (conditional) {
      units.push({
        kind: 'conditional',
        text: line.text,
        start: line.start,
        end: line.end,
        label: line.text.trim(),
        note: 'branch retained; activation condition not evaluated',
      });
      i++;
      continue;
    }

    if (RE_DIFF.test(line.text)) {
      units.push({
        kind: 'diff',
        text: line.text,
        start: line.start,
        end: line.end,
        label: 'diff hunk',
      });
      i++;
      continue;
    }

    if (RE_STACK.test(line.text)) {
      units.push({
        kind: 'stack',
        text: line.text,
        start: line.start,
        end: line.end,
        label: 'stack frame',
      });
      i++;
      continue;
    }

    if (RE_MESSAGE.test(line.text)) {
      units.push({
        kind: 'message',
        text: line.text,
        start: line.start,
        end: line.end,
        label: line.text.split(':')[0].trim(),
      });
      i++;
      continue;
    }

    const nextIsSeparator = i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1].text);
    const prevIsSeparator = i > 0 && RE_TABLE_SEP.test(lines[i - 1].text);
    if ((nextIsSeparator || prevIsSeparator) && countPipes(line.text) >= 1) {
      const start = line.start;
      let j = i;
      while (j < lines.length && !isBlank(lines[j].text) && countPipes(lines[j].text) >= 1) j++;
      const end = lines[j - 1]?.end ?? line.end;
      units.push({ kind: 'table', text: text.slice(start, end), start, end, label: 'table' });
      i = j;
      continue;
    }

    if (RE_LIST.test(line.text)) {
      const start = line.start;
      let j = i;
      while (j < lines.length && (RE_LIST.test(lines[j].text) || /^\s{2,}\S/.test(lines[j].text))) {
        if (isBlank(lines[j].text)) break;
        j++;
      }
      const end = lines[j - 1]?.end ?? line.end;
      units.push({ kind: 'list', text: text.slice(start, end), start, end, label: 'list' });
      i = j;
      continue;
    }

    const structuredKey =
      (kind === 'yaml' || kind === 'toml' || kind === 'xml') && RE_KEYVALUE.test(line.text);
    if (structuredKey) {
      const key = line.text.split(/[:=]/)[0].trim();
      units.push({
        kind: 'keyvalue',
        text: line.text,
        start: line.start,
        end: line.end,
        label: key,
      });
      i++;
      continue;
    }

    // Paragraph: run of lines that start no special unit.
    const start = line.start;
    let j = i;
    let lastEnd = line.end;
    while (j < lines.length) {
      const candidate = lines[j].text;
      if (isBlank(candidate)) break;
      if (j > i) {
        const startsSpecial =
          RE_FENCE.test(candidate) ||
          RE_HEADING.test(candidate) ||
          RE_CONDITIONAL.test(candidate) ||
          RE_DIFF.test(candidate) ||
          RE_STACK.test(candidate) ||
          RE_MESSAGE.test(candidate) ||
          RE_LIST.test(candidate) ||
          ((kind === 'yaml' || kind === 'toml' || kind === 'xml') && RE_KEYVALUE.test(candidate));
        if (startsSpecial) break;
      }
      lastEnd = lines[j].end;
      j++;
    }
    units.push({ kind: 'paragraph', text: text.slice(start, lastEnd), start, end: lastEnd });
    i = j > i ? j : i + 1;
  }

  return units;
}

function segmentJson(text: string): ContentUnit[] {
  try {
    const parsed: unknown = JSON.parse(text);
    const units: ContentUnit[] = [];
    collectJson(parsed, '', units, text, 0);
    if (units.length === 0) {
      units.push({ kind: 'keyvalue', text: text.slice(0, 2000), start: 0, end: Math.min(text.length, 2000), label: '$' });
    }
    return units;
  } catch {
    // Keep the unmodified, readable text with a structural-recognition limitation.
    return segment(text, 'text');
  }
}

function collectJson(
  value: unknown,
  path: string,
  units: ContentUnit[],
  source: string,
  depth: number,
): void {
  if (units.length >= 300) return;
  if (value === null || typeof value !== 'object') {
    const label = path || '$';
    const key = path.split('.').pop() ?? '';
    const at = key ? source.indexOf(key) : -1;
    units.push({
      kind: 'keyvalue',
      text: `${label}: ${JSON.stringify(value)}`,
      start: at >= 0 ? at : 0,
      end: at >= 0 ? at + key.length : 0,
      label,
    });
    return;
  }
  if (depth > 3) return;
  if (Array.isArray(value)) {
    units.push({
      kind: 'keyvalue',
      text: `${path || '$'}: [array of ${value.length}]`,
      start: 0,
      end: 0,
      label: path || '$',
    });
    value.slice(0, 20).forEach((item, idx) => collectJson(item, `${path}[${idx}]`, units, source, depth + 1));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectJson(child, path ? `${path}.${key}` : key, units, source, depth + 1);
  }
}

/* -------------------------------------------------------------------- images */

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function imageInfo(bytes: Uint8Array, kind: FormatKind): ImageInfo | null {
  try {
    if (kind === 'image-png') {
      if (bytes.length < 24) return null;
      const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
      const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
      return { format: 'PNG', width, height };
    }
    if (kind === 'image-jpeg') {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = bytes[offset + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
          const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
          return { format: 'JPEG', width, height };
        }
        const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
        if (length <= 0) return null;
        offset += 2 + length;
      }
      return null;
    }
    if (kind === 'image-webp') {
      if (bytes.length < 30) return null;
      const fourcc = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
      if (fourcc === 'VP8X') {
        return { format: 'WebP (extended)', width: readUint24LE(bytes, 24) + 1, height: readUint24LE(bytes, 27) + 1 };
      }
      if (fourcc === 'VP8 ') {
        const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
        const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
        return { format: 'WebP (lossy)', width, height };
      }
      if (fourcc === 'VP8L') {
        const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
        return {
          format: 'WebP (lossless)',
          width: (bits & 0x3fff) + 1,
          height: ((bits >> 14) & 0x3fff) + 1,
        };
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

/* -------------------------------------------------------------------- router */

const STRUCTURED: FormatKind[] = ['json', 'yaml', 'toml', 'xml', 'csv'];

export function readTextContent(bytes: Uint8Array, kind: FormatKind): ReadResult {
  const notes: string[] = [];
  let outcome: TerminalOutcome = 'completed';
  let reason: string | undefined;

  const decoded = decodeUtf8(bytes);
  if (!decoded.fatal) {
    outcome = 'partial';
    reason = 'Contains invalid UTF-8 byte sequences; retained text is a lossy preview.';
    notes.push('Decoded with a replacement-character fallback (lossy preview).');
  }

  let text = decoded.text;
  let truncated = false;
  if (text.length > BUDGETS.maxRetainedChars) {
    text = text.slice(0, BUDGETS.maxRetainedChars);
    truncated = true;
    notes.push(
      `Text capped at ${BUDGETS.maxRetainedChars} characters; the tail is not included in the consolidated output.`,
    );
    if (outcome === 'completed') outcome = 'partial';
    reason = reason ?? `Source exceeds the retained-text budget (${BUDGETS.maxRetainedChars} characters).`;
  }

  if (kind === 'json' && decoded.fatal) {
    try {
      JSON.parse(text);
    } catch (error) {
      outcome = 'partial';
      reason = `JSON parse failed: ${error instanceof Error ? error.message : 'invalid JSON'}. Raw text retained.`;
      notes.push('Fell back to bounded structural recognition.');
    }
  }

  const units = segment(text, kind);
  return { outcome, reason, text, units, notes, truncated };
}

export function readImageContent(bytes: Uint8Array, kind: FormatKind): ReadResult {
  const info = imageInfo(bytes, kind);
  const notes = ['Content not interpreted — no vision or OCR is available in this build.'];
  if (!info) {
    return {
      outcome: 'partial',
      reason: 'Image recognised, but its dimensions could not be decoded from the header.',
      image: { format: kind.replace('image-', '').toUpperCase(), width: 0, height: 0 },
      notes,
      truncated: false,
    };
  }
  return { outcome: 'completed', image: info, notes, truncated: false };
}

export function readContent(bytes: Uint8Array, kind: FormatKind): ReadResult {
  if (kind === 'archive-zip' || kind === 'archive-tar' || kind === 'archive-tgz') {
    return {
      outcome: 'unsupported',
      reason: 'Archive content is handled by the bounded archive scanner, not the text reader.',
      notes: [],
      truncated: false,
    };
  }
  if (kind === 'image-png' || kind === 'image-jpeg' || kind === 'image-webp') {
    return readImageContent(bytes, kind);
  }
  if (kind === 'unknown') {
    return {
      outcome: 'unsupported',
      reason: 'Format not recognised; content was not interpreted.',
      notes: ['Recorded so the registry can report it honestly.'],
      truncated: false,
    };
  }
  return readTextContent(bytes, kind);
}

export function isStructuredKind(kind: FormatKind): boolean {
  return STRUCTURED.includes(kind);
}
