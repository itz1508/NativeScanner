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
      <div className="rounded-xl border-2 border-dashed border-border/60 px-4 py-8 text-center">
        <p className="text-[13px] font-semibold text-foreground">Nothing registered yet</p>
        <p className="mx-auto mt-2 max-w-[30ch] text-[11.5px] leading-relaxed text-muted">
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
            className={`rounded-xl border bg-gradient-to-br from-surface to-surface/50 transition-all duration-200 ${
              isBaseline ? 'border-primary/60 shadow-sm shadow-primary/10' : 'border-border/80'
            }`}
          >
            <div className="flex items-start gap-2.5 p-3">
              <label className="mt-1 flex cursor-pointer items-center" title="Mark as the baseline source">
                <input
                  type="radio"
                  name="oneshot-baseline"
                  checked={isBaseline}
                  onChange={() => onBaseline(item.id)}
                  aria-label={`Mark ${item.name} as the baseline source`}
                  className="size-4 cursor-pointer accent-[var(--color-primary)]"
                />
              </label>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <KindIcon
                    category={root?.category ?? (item.origin === 'paste' ? 'text' : 'unknown')}
                    className="text-faint"
                  />
                  <span className="truncate font-mono text-[12.5px] font-medium text-foreground" title={item.name}>
                    {item.name}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-faint">
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
                  <p className="mt-1 truncate font-mono text-[11px] text-faint" title={root.provenanceLabel}>
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
                  className="cursor-pointer rounded-lg border border-transparent p-1.5 text-faint transition-all duration-200 hover:border-border/60 hover:bg-elevated/50 hover:text-danger"
                >
                  <TrashIcon className="size-4" />
                </button>
              </div>
            </div>

            {item.origin === 'paste' && (
              <div className="px-3 pb-3">
                <textarea
                  value={item.pasteText ?? ''}
                  onChange={(event) => onPasteChange(item.id, event.target.value)}
                  rows={3}
                  spellCheck={false}
                  aria-label={`Content of ${item.name}`}
                  placeholder="Paste text, code, a log, or structured data…"
                  className="scroll-thin w-full resize-y rounded-xl border border-border/60 bg-elevated/50 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-foreground placeholder:text-faint focus:border-primary/80 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-200"
                />
              </div>
            )}

            <div className="border-t border-border/60 px-3 py-2.5">
              <label className="block">
                <span className="text-[10.5px] font-semibold tracking-wide text-faint uppercase">
                  Relationship hint (optional)
                </span>
                <input
                  type="text"
                  value={item.hint}
                  onChange={(event) => onHint(item.id, event.target.value)}
                  placeholder="e.g. archive-B is newer than archive-A"
                  className="mt-1.5 w-full rounded-lg border border-border/60 bg-elevated/50 px-3 py-2 text-[11.5px] text-foreground placeholder:text-faint focus:border-primary/80 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-200"
                />
              </label>
            </div>

            {members.length > 0 && (
              <ul className="space-y-1.5 border-t border-border/60 px-3 py-2.5">
                {members.slice(0, 60).map((node) => (
                  <li key={node.id} className="flex items-center gap-2 text-[11.5px]">
                    <span className="size-1.5 shrink-0 rounded-full bg-border" aria-hidden="true" />
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
                  <li className="text-[11px] text-faint">
                    +{members.length - 60} more member(s) — listed in full inside the generated file.
                  </li>
                )}
              </ul>
            )}

            {blocked && root?.reason && (
              <p className="border-t border-border/60 px-3 py-2.5 text-[11.5px] leading-relaxed text-warning">
                {root.reason}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
