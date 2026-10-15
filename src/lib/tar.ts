/**
 * A small, bounded USTAR/PAX reader. TAR is not covered by fflate, so this is
 * hand-rolled (512-byte headers, octal/base-256 sizes, type flags). Every read is
 * bounds-checked; nothing here allocates based on an untrusted size field without
 * first proving the bytes exist.
 */

export interface TarEntry {
  path: string;
  size: number;
  typeflag: string;
  data: Uint8Array | null;
  outcome: 'ok' | 'blocked';
  reason?: string;
}

export interface TarResult {
  entries: TarEntry[];
  reason?: string;
  truncated: boolean;
}

const BLOCK = 512;

function isZeroBlock(block: Uint8Array): boolean {
  for (let i = 0; i < block.length; i++) if (block[i] !== 0) return false;
  return true;
}

function readString(bytes: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = Math.min(offset + length, bytes.length);
  while (end < limit && bytes[end] !== 0) end++;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(offset, end)).trim();
}

function readSize(header: Uint8Array, offset: number, length: number): number {
  // GNU base-256 encoding for large values.
  if (header[offset] & 0x80) {
    let value = 0;
    for (let i = offset + 1; i < offset + length; i++) value = value * 256 + header[i];
    return value;
  }
  let value = 0;
  for (let i = offset; i < offset + length; i++) {
    const c = header[i];
    if (c === 0 || c === 0x20) continue;
    if (c < 0x30 || c > 0x37) break;
    value = value * 8 + (c - 0x30);
  }
  return value;
}

function verifyChecksum(header: Uint8Array): boolean {
  const recorded = readSize(header, 148, 8);
  if (!recorded) return false;
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {
    sum += i >= 148 && i < 156 ? 0x20 : header[i];
  }
  return sum === recorded;
}

function safeSlice(bytes: Uint8Array, offset: number, size: number): Uint8Array | null {
  if (size < 0) return null;
  if (offset + size > bytes.length) return null;
  return bytes.subarray(offset, offset + size);
}

function roundUp(size: number): number {
  return Math.ceil(size / BLOCK) * BLOCK;
}

/** Parses PAX extended-header records of the form `%d key=value\n`. */
function parsePax(payload: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const text = new TextDecoder('utf-8', { fatal: false }).decode(payload);
  let cursor = 0;
  while (cursor < text.length) {
    const space = text.indexOf(' ', cursor);
    if (space === -1) break;
    const recordLength = Number.parseInt(text.slice(cursor, space), 10);
    if (!Number.isFinite(recordLength) || recordLength <= 0) break;
    const record = text.slice(space + 1, cursor + recordLength);
    const eq = record.indexOf('=');
    if (eq > 0) {
      const key = record.slice(0, eq);
      const value = record.slice(eq + 1).replace(/\n$/, '');
      out[key] = value;
    }
    cursor += recordLength;
  }
  return out;
}

const BLOCKED_TYPES: Record<string, string> = {
  '1': 'hard link member — not followed',
  '2': 'symbolic link member — not followed',
  '3': 'character device member — not read',
  '4': 'block device member — not read',
  '6': 'FIFO member — not read',
};

export function parseTar(bytes: Uint8Array, opts: { maxEntries: number }): TarResult {
  const entries: TarEntry[] = [];
  let offset = 0;
  let pendingPax: Record<string, string> = {};
  let longName: string | undefined;
  let zeroBlocks = 0;
  let truncated = false;
  let reason: string | undefined;

  while (offset + BLOCK <= bytes.length) {
    const header = bytes.subarray(offset, offset + BLOCK);

    if (isZeroBlock(header)) {
      zeroBlocks++;
      offset += BLOCK;
      if (zeroBlocks >= 2) break;
      continue;
    }
    zeroBlocks = 0;

    if (!verifyChecksum(header)) {
      truncated = true;
      reason = 'TAR header checksum mismatch — archive is corrupt or truncated';
      break;
    }

    let path = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    if (prefix && !path.startsWith('/')) path = `${prefix}/${path}`;
    let size = readSize(header, 124, 12);
    const typeflag = String.fromCharCode(header[156] || 0x30);
    offset += BLOCK;

    if (entries.length >= opts.maxEntries) {
      truncated = true;
      reason = `TAR entry count exceeded the limit of ${opts.maxEntries}`;
      break;
    }

    if (typeflag === 'x' || typeflag === 'g') {
      const payload = safeSlice(bytes, offset, size);
      if (!payload) {
        truncated = true;
        reason = 'truncated PAX extended header';
        break;
      }
      const records = parsePax(payload);
      if (typeflag === 'x') pendingPax = { ...pendingPax, ...records };
      offset += roundUp(size);
      continue;
    }

    if (typeflag === 'L') {
      const payload = safeSlice(bytes, offset, size);
      longName = payload
        ? new TextDecoder('utf-8', { fatal: false }).decode(payload).replace(/\0+$/, '')
        : undefined;
      offset += roundUp(size);
      continue;
    }

    if (typeflag === 'K') {
      offset += roundUp(size);
      continue;
    }

    if (pendingPax.path) path = pendingPax.path;
    if (pendingPax.size) {
      const paxSize = Number.parseInt(pendingPax.size, 10);
      if (Number.isFinite(paxSize)) size = paxSize;
    }
    if (longName) {
      path = longName;
      longName = undefined;
    }
    pendingPax = {};

    if (typeflag === '5') {
      // Directory: nothing to read, nothing to report as content.
      offset += roundUp(size);
      continue;
    }

    const blockedReason = BLOCKED_TYPES[typeflag];
    if (blockedReason) {
      entries.push({ path, size, typeflag, data: null, outcome: 'blocked', reason: blockedReason });
      offset += roundUp(size);
      continue;
    }

    const data = safeSlice(bytes, offset, size);
    if (!data) {
      truncated = true;
      reason = `TAR member "${path}" extends past the end of the input`;
      break;
    }
    entries.push({ path, size, typeflag, data, outcome: 'ok' });
    offset += roundUp(size);
  }

  return { entries, reason, truncated };
}
