import type { FormatKind, SourceNode } from '../types';

export interface ArchiveWorkerRequest {
  type: 'scan-archive';
  id: string;
  name: string;
  kind: FormatKind;
  /** A transferable copy of the archive bytes. */
  bytes: ArrayBuffer;
  /** Absolute ms timestamp by which the job must finish. */
  deadline: number;
}

export interface ArchiveWorkerResponse {
  type: 'archive-result';
  id: string;
  ok: boolean;
  nodes: SourceNode[];
  budgetHits: string[];
  error?: string;
}
