import { buildNodes, createArchiveCtx } from './archiveCore';
import { BUDGETS } from './constants';
import type { ArchiveWorkerRequest, ArchiveWorkerResponse } from './archiveProtocol';

/**
 * Dedicated Web Worker that owns all archive decoding.
 *
 * Running here keeps the UI responsive, lets a runaway archive be hard-terminated
 * by the main thread, and keeps untrusted parsers off the main thread entirely.
 */

interface WorkerScope {
  onmessage: ((event: MessageEvent<ArchiveWorkerRequest>) => void) | null;
  postMessage: (message: ArchiveWorkerResponse) => void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent<ArchiveWorkerRequest>) => {
  const request = event.data;
  if (!request || request.type !== 'scan-archive') return;
  void handle(request);
};

async function handle(request: ArchiveWorkerRequest): Promise<void> {
  const deadline = Math.min(request.deadline, Date.now() + BUDGETS.archiveWallMs);
  const ctx = createArchiveCtx(deadline);
  try {
    const nodes = await buildNodes(new Uint8Array(request.bytes), request.name, {
      depth: 0,
      origin: 'file',
      provenance: [],
      ctx,
    });
    scope.postMessage({
      type: 'archive-result',
      id: request.id,
      ok: true,
      nodes,
      budgetHits: ctx.budgetHits,
    });
  } catch (error) {
    scope.postMessage({
      type: 'archive-result',
      id: request.id,
      ok: false,
      nodes: [],
      budgetHits: ctx.budgetHits,
      error: error instanceof Error ? error.message : 'archive scan failed',
    });
  }
}
