import type { FormatKind, SourceCategory } from '../types';
import { asciiAt, extOf, startsWithBytes } from './util';

export interface Recognition {
  kind: FormatKind;
  category: SourceCategory;
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
  /** True when the byte signature disagreed with the file extension. */
  conflict: boolean;
}

interface KindInfo {
  kind: FormatKind;
  category: SourceCategory;
}

interface ByteSignature extends KindInfo {
  label: string;
  test: (bytes: Uint8Array) => boolean;
}

const BYTE_SIGNATURES: ByteSignature[] = [
  {
    kind: 'archive-zip',
    category: 'archive',
    label: 'ZIP local file header (PK\\x03\\x04)',
    test: (b) =>
      startsWithBytes(b, [0x50, 0x4b, 0x03, 0x04]) ||
      startsWithBytes(b, [0x50, 0x4b, 0x05, 0x06]) ||
      startsWithBytes(b, [0x50, 0x4b, 0x07, 0x08]),
  },
  {
    kind: 'archive-tgz',
    category: 'archive',
    label: 'GZIP member header (\\x1f\\x8b)',
    test: (b) => startsWithBytes(b, [0x1f, 0x8b]),
  },
  {
    kind: 'image-png',
    category: 'image',
    label: 'PNG signature (\\x89PNG\\r\\n\\x1a\\n)',
    test: (b) => startsWithBytes(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    kind: 'image-jpeg',
    category: 'image',
    label: 'JPEG start-of-image (\\xff\\xd8\\xff)',
    test: (b) => startsWithBytes(b, [0xff, 0xd8, 0xff]),
  },
  {
    kind: 'image-webp',
    category: 'image',
    label: 'RIFF/WEBP container',
    test: (b) => asciiAt(b, 0, 'RIFF') && asciiAt(b, 8, 'WEBP'),
  },
];

const EXT_KINDS: Record<string, KindInfo> = {
  '.zip': { kind: 'archive-zip', category: 'archive' },
  '.tar': { kind: 'archive-tar', category: 'archive' },
  '.tgz': { kind: 'archive-tgz', category: 'archive' },
  '.gz': { kind: 'archive-tgz', category: 'archive' },
  '.png': { kind: 'image-png', category: 'image' },
  '.jpg': { kind: 'image-jpeg', category: 'image' },
  '.jpeg': { kind: 'image-jpeg', category: 'image' },
  '.webp': { kind: 'image-webp', category: 'image' },
  '.json': { kind: 'json', category: 'structured' },
  '.jsonc': { kind: 'json', category: 'structured' },
  '.jsonl': { kind: 'json', category: 'structured' },
  '.yaml': { kind: 'yaml', category: 'structured' },
  '.yml': { kind: 'yaml', category: 'structured' },
  '.toml': { kind: 'toml', category: 'structured' },
  '.xml': { kind: 'xml', category: 'structured' },
  '.svg': { kind: 'xml', category: 'structured' },
  '.csv': { kind: 'csv', category: 'structured' },
  '.tsv': { kind: 'csv', category: 'structured' },
  '.md': { kind: 'markdown', category: 'text' },
  '.markdown': { kind: 'markdown', category: 'text' },
  '.mdx': { kind: 'markdown', category: 'text' },
  '.txt': { kind: 'text', category: 'text' },
  '.log': { kind: 'log', category: 'text' },
};

const CODE_EXTS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs',
  '.java', '.kt', '.kts', '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.cs',
  '.php', '.swift', '.sh', '.bash', '.zsh', '.fish', '.sql', '.css', '.scss',
  '.sass', '.less', '.html', '.htm', '.vue', '.svelte', '.lua', '.r', '.pl',
  '.dart', '.scala', '.ex', '.exs', '.erl', '.hs', '.clj', '.ini', '.cfg',
  '.conf', '.properties', '.gradle', '.proto', '.graphql', '.tf', '.dockerfile',
];
for (const e of CODE_EXTS) EXT_KINDS[e] = { kind: 'code', category: 'text' };

const BARE_NAMES: Record<string, KindInfo> = {
  dockerfile: { kind: 'code', category: 'text' },
  makefile: { kind: 'code', category: 'text' },
  'readme': { kind: 'markdown', category: 'text' },
  'readme.md': { kind: 'markdown', category: 'text' },
  'requirements.txt': { kind: 'text', category: 'text' },
};

function looksLikeText(bytes: Uint8Array): boolean {
  const probe = bytes.subarray(0, Math.min(bytes.length, 4096));
  if (probe.length === 0) return true;
  let control = 0;
  for (let i = 0; i < probe.length; i++) {
    const b = probe[i];
    if (b === 0x00) return false;
    if (b < 0x09 || (b > 0x0d && b < 0x20)) control++;
  }
  if (control / probe.length > 0.05) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recognition order: content signature/magic → extension hint → known file name
 * → bounded non-executing text probe. Content signatures always win, and a
 * disagreement with the extension is recorded rather than hidden.
 */
export function recognize(bytes: Uint8Array, name: string): Recognition {
  const ext = extOf(name);
  const extHit: KindInfo | undefined = EXT_KINDS[ext];
  const nameHit: KindInfo | undefined = BARE_NAMES[name.toLowerCase()];

  const sig = BYTE_SIGNATURES.find((s) => s.test(bytes));
  if (sig) {
    const conflict = !!extHit && extHit.kind !== sig.kind && extHit.category !== sig.category;
    const evidence = conflict
      ? `${sig.label} — overrides misleading "${ext}" extension`
      : sig.label;
    return { kind: sig.kind, category: sig.category, confidence: 'high', evidence, conflict };
  }

  if (asciiAt(bytes, 257, 'ustar')) {
    return {
      kind: 'archive-tar',
      category: 'archive',
      confidence: 'high',
      evidence: 'POSIX ustar header at offset 257',
      conflict: !!extHit && extHit.kind !== 'archive-tar',
    };
  }

  if (extHit) {
    const evidence =
      extHit.category === 'image' || extHit.category === 'archive'
        ? `extension "${ext}" (no matching signature — will be validated on read)`
        : `extension "${ext}"`;
    return { ...extHit, confidence: 'medium', evidence, conflict: false };
  }

  if (nameHit) {
    return { ...nameHit, confidence: 'medium', evidence: `known file name`, conflict: false };
  }

  if (looksLikeText(bytes)) {
    return {
      kind: 'text',
      category: 'text',
      confidence: 'low',
      evidence: 'no signature or extension; bytes decode as UTF-8 text',
      conflict: false,
    };
  }

  return {
    kind: 'unknown',
    category: 'unknown',
    confidence: 'low',
    evidence: 'no recognised signature, extension or file name',
    conflict: false,
  };
}

export function isArchiveKind(kind: FormatKind): boolean {
  return kind === 'archive-zip' || kind === 'archive-tar' || kind === 'archive-tgz';
}

export function isImageKind(kind: FormatKind): boolean {
  return kind === 'image-png' || kind === 'image-jpeg' || kind === 'image-webp';
}
