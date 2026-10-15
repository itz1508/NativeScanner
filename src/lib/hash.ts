import { toHex } from './util';

/**
 * SHA-256 of raw bytes via the platform Web Crypto API. Used for exact-duplicate
 * recognition and change detection. No credential, no network.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view so the digest call is well-typed
  // and never observes a detached/shared buffer.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return toHex(new Uint8Array(digest));
}

export async function sha256String(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}
