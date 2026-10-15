import { OUTCOME_LABEL } from '../lib/constants';
import type { FormatKind, SourceCategory, TerminalOutcome } from '../types';
import { ArchiveIcon, FileIcon, ImageIcon, TextIcon } from './Icons';

const OUTCOME_CLASS: Record<TerminalOutcome, string> = {
  completed: 'border-success/50 bg-success/10 text-success',
  partial: 'border-warning/50 bg-warning/10 text-warning',
  blocked: 'border-danger/50 bg-danger/10 text-danger',
  unsupported: 'border-border/60 bg-elevated/50 text-muted',
  'timed-out': 'border-warning/50 bg-warning/10 text-warning',
  failed: 'border-danger/50 bg-danger/10 text-danger',
};

const OUTCOME_DOT: Record<TerminalOutcome, string> = {
  completed: 'bg-success',
  partial: 'bg-warning',
  blocked: 'bg-danger',
  unsupported: 'bg-faint',
  'timed-out': 'bg-warning',
  failed: 'bg-danger',
};

export function OutcomeChip({ outcome, className = '' }: { outcome: TerminalOutcome; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold tracking-wide ${OUTCOME_CLASS[outcome]} ${className}`}
      title={OUTCOME_LABEL[outcome]}
    >
      <span className={`size-1.5 rounded-full ${OUTCOME_DOT[outcome]}`} aria-hidden="true" />
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

export function KindIcon({ category, className = '' }: { category: SourceCategory; className?: string }) {
  const shared = `size-4 shrink-0 ${className}`;
  if (category === 'archive') return <ArchiveIcon className={shared} />;
  if (category === 'image') return <ImageIcon className={shared} />;
  if (category === 'text' || category === 'structured') return <TextIcon className={shared} />;
  return <FileIcon className={shared} />;
}

const KIND_LABEL: Partial<Record<FormatKind, string>> = {
  'archive-zip': 'ZIP',
  'archive-tar': 'TAR',
  'archive-tgz': 'TGZ',
  'image-png': 'PNG',
  'image-jpeg': 'JPEG',
  'image-webp': 'WebP',
};

export function kindLabel(kind: FormatKind): string {
  return KIND_LABEL[kind] ?? kind;
}
