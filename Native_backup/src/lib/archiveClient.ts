import type { FormatKind, SourceNode } from '../types';
import type { ArchiveWorkerRequest, ArchiveWorkerResponse } from './archiveProtocol';

export interface ArchiveJobResult {
  nodes: SourceNode[];
  budgetHits: string[];
  error?: string;
}

/**
 * Main-thread handle for the archive worker. Owns worker lifecycle: it spawns the
 * worker lazily, correlates responses by job id, enforces a wall-clock timeout and
 * can terminate a stuck worker so the UI never freezes.
 */
export class ArchiveWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<string, (response: ArchiveWorkerResponse) => void>();

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./archive.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<ArchiveWorkerResponse>) => {
      const resolve = this.pending.get(event.data.id);
      if (resolve) {
        this.pending.delete(event.data.id);
        resolve(event.data);
      }
    };
    this.worker = worker;
    return worker;
  }

  scan(
    id: string,
    name: string,
    kind: FormatKind,
    bytes: Uint8Array,
    deadline: number,
  ): Promise<ArchiveJobResult> {
    const worker = this.ensure();
    // Transfer a private copy so the caller's buffer stays intact.
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Promise<ArchiveJobResult>((resolve) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          this.terminate();
          resolve({
            nodes: [],
            budgetHits: ['archive-wall-clock'],
            error: `archive "${name}" exceeded its wall-clock budget and was terminated`,
          });
        },
        Math.max(1000, deadline - Date.now()),
      );

      this.pending.set(id, (response) => {
        clearTimeout(timer);
        resolve({
          nodes: response.nodes,
          budgetHits: response.budgetHits,
          error: response.ok ? undefined : response.error,
        });
      });

      const request: ArchiveWorkerRequest = { type: 'scan-archive', id, name, kind, bytes: buffer, deadline };
      try {
        worker.postMessage(request, [buffer]);
      } catch {
        const copy = new Uint8Array(bytes);
        worker.postMessage({ ...request, bytes: copy.buffer as ArrayBuffer }, [copy.buffer as ArrayBuffer]);
      }
    });
  }

  /** Terminates the worker and rejects everything still in flight. */
  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    const outstanding = Array.from(this.pending.entries());
    this.pending.clear();
    for (const [id, resolve] of outstanding) {
      resolve({ type: 'archive-result', id, ok: false, nodes: [], budgetHits: [], error: 'scan cancelled' });
    }
  }
}
