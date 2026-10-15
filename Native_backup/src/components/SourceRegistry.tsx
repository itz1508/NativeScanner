import { formatBytes } from '../lib/util';
import type { InputItem, ScanResult, SourceNode } from '../types';
import { KindIcon, OutcomeChip, kindLabel } from './Chip';
import { TrashIcon } from './Icons';

interface SourceRegistryProps {
  inputs: InputItem[];
  result: ScanResult | null;
  baselineId?: string;
  onBaseline: (id: string) => void;
  onHint: (id: string, hint: string) => void;
  onRemove: (id: string) => void;
  onPasteChange: (id: string, text: string) => void;
}

function memberRowsFor(result: ScanResult | null, root: SourceNode | undefined): SourceNode[] {
  if (!result || !root) return [];
  return result.nodes.filter((node) => node.depth > 0 && node.provenance[0] === root.name);
}

export function SourceRegistry({
  inputs,
  result,
  baselineId,
  onBaseline,
  onHint,
  onRemove,
  onPasteChange,
}: SourceRegistryProps) {
  if (inputs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center">
        <p className="text-[12.5px] font-medium text-foreground">Nothing registered yet</p>
        <p className="mx-auto mt-1 max-w-[28ch] text-[11.5px] leading-relaxed text-muted">
          Add pasted text, drop files, or attach archives and images above. Each one gets its own row here, with an
          honest status once you scan.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {inputs.map((item) => {
        const rootId = result?.inputRootIds[item.id];
        const root = rootId ? result?.nodes.find((node) => node.id === rootId) : undefined;
        const members = memberRowsFor(result, root);
        const isBaseline = baselineId === item.id;
        const blocked = root && root.outcome !== 'completed';

        return (
          <li
            key={item.id}
            className={`rounded-lg border bg-surface transition-colors duration-150 ${
              isBaseline ? 'border-primary/50' : 'border-border'
            }`}
          >
            <div className="flex items-start gap-2 p-2.5">
              <label className="mt-1 flex cursor-pointer items-center" title="Mark as the baseline source">
                <input
                  type="radio"
                  name="oneshot-baseline"
                  checked={isBaseline}
                  onChange={() => onBaseline(item.id)}
                  aria-label={`Mark ${item.name} as the baseline source`}
                  className="size-3.5 cursor-pointer accent-[var(--color-primary)]"
                />
              </label>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <KindIcon
                    category={root?.category ?? (item.origin === 'paste' ? 'text' : 'unknown')}
                    className="text-faint"
                  />
                  <span className="truncate font-mono text-[12px] text-foreground" title={item.name}>
                    {item.name}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-faint">
                  <span>{item.origin === 'paste' ? 'Pasted text' : 'Attached file'}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{formatBytes(item.size)}</span>
                  {root && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{kindLabel(root.kind)}</span>
                    </>
                  )}
                  {root?.image && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {root.image.width}×{root.image.height}
                      </span>
                    </>
                  )}
                </div>
                {root && (
                  <p className="mt-1 truncate font-mono text-[10.5px] text-faint" title={root.provenanceLabel}>
                    {root.provenanceLabel}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {root && <OutcomeChip outcome={root.outcome} />}
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  aria-label={`Remove ${item.name}`}
                  className="cursor-pointer rounded-md border border-transparent p-1.5 text-faint transition-colors duration-150 hover:border-border hover:bg-elevated hover:text-danger"
                >
                  <TrashIcon className="size-3.5" />
                </button>
              </div>
            </div>

            {item.origin === 'paste' && (
              <div className="px-2.5 pb-2.5">
                <textarea
                  value={item.pasteText ?? ''}
                  onChange={(event) => onPasteChange(item.id, event.target.value)}
                  rows={3}
                  spellCheck={false}
                  aria-label={`Content of ${item.name}`}
                  placeholder="Paste text, code, a log, or structured data…"
                  className="scroll-thin w-full resize-y rounded-md border border-border bg-elevated px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-foreground placeholder:text-faint focus:border-primary focus:outline-none"
                />
              </div>
            )}

            <div className="border-t border-border/70 px-2.5 py-2">
              <label className="block">
                <span className="text-[10.5px] font-medium tracking-wide text-faint uppercase">
                  Relationship hint (optional)
                </span>
                <input
                  type="text"
                  value={item.hint}
                  onChange={(event) => onHint(item.id, event.target.value)}
                  placeholder="e.g. archive-B is newer than archive-A"
                  className="mt-1 w-full rounded-md border border-border bg-elevated px-2 py-1.5 text-[11.5px] text-foreground placeholder:text-faint focus:border-primary focus:outline-none"
                />
              </label>
            </div>

            {members.length > 0 && (
              <ul className="space-y-1 border-t border-border/70 px-2.5 py-2">
                {members.slice(0, 60).map((node) => (
                  <li key={node.id} className="flex items-center gap-2 text-[11px]">
                    <span className="size-1 shrink-0 rounded-full bg-border" aria-hidden="true" />
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-muted"
                      style={{ paddingLeft: `${(node.depth - 1) * 10}px` }}
                      title={node.provenanceLabel}
                    >
                      {node.provenance.slice(1).join(' / ')}
                    </span>
                    <span className="shrink-0 tabular-nums text-faint">{formatBytes(node.size)}</span>
                    <OutcomeChip outcome={node.outcome} />
                  </li>
                ))}
                {members.length > 60 && (
                  <li className="text-[10.5px] text-faint">
                    +{members.length - 60} more member(s) — listed in full inside the generated file.
                  </li>
                )}
              </ul>
            )}

            {blocked && root?.reason && (
              <p className="border-t border-border/70 px-2.5 py-2 text-[11px] leading-relaxed text-warning">
                {root.reason}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
