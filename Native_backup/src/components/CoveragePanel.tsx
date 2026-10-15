import { BUDGETS, OUTCOME_LABEL } from '../lib/constants';
import { formatBytes } from '../lib/util';
import type { ScanResult, TerminalOutcome } from '../types';
import { OutcomeChip, KindIcon } from './Chip';
import { InfoIcon } from './Icons';

interface CoveragePanelProps {
  result: ScanResult | null;
  inputCount: number;
}

export function CoveragePanel({ result, inputCount }: CoveragePanelProps) {
  if (!result) {
    return (
      <section
        aria-label="Coverage and limitations"
        className="flex min-h-0 flex-col rounded-xl border border-border bg-surface p-3.5"
      >
        <h2 className="text-[11px] font-medium tracking-wide text-faint uppercase">Coverage &amp; limitations</h2>
        <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-6 text-center">
          <InfoIcon className="mx-auto size-4 text-faint" />
          <p className="mt-2 text-[12px] font-medium text-foreground">Honest reporting, not a sales pitch</p>
          <p className="mx-auto mt-1 max-w-[30ch] text-[11.5px] leading-relaxed text-muted">
            After a scan this panel lists every source's terminal outcome, the budgets that were enforced, the
            input→output token estimate, and exactly what could not be read.
          </p>
        </div>
        {inputCount > 0 && (
          <p className="mt-3 text-[11px] text-faint">
            {inputCount} source{inputCount === 1 ? '' : 's'} queued. Run a scan to see their outcomes.
          </p>
        )}
      </section>
    );
  }

  const counts = new Map<TerminalOutcome, number>();
  for (const row of result.coverage) counts.set(row.outcome, (counts.get(row.outcome) ?? 0) + 1);

  const totalInput = Math.max(1, result.tokenEstimate.inputTokens + result.tokenEstimate.outputTokens);
  const outputShare = Math.min(100, Math.round((result.tokenEstimate.outputTokens / totalInput) * 100));

  return (
    <section
      aria-label="Coverage and limitations"
      className="flex min-h-0 flex-col gap-3 overflow-hidden rounded-xl border border-border bg-surface p-3.5"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-medium tracking-wide text-faint uppercase">Coverage &amp; limitations</h2>
        <OutcomeChip outcome={result.finalOutcome} />
      </div>

      <div>
        <div className="flex items-baseline justify-between text-[11px]">
          <span className="text-muted">Input → output</span>
          <span className="tabular-nums text-faint">
            ~{result.tokenEstimate.inputTokens.toLocaleString()} →{' '}
            {result.tokenEstimate.outputTokens.toLocaleString()} tok
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-elevated">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
            style={{ width: `${outputShare}%` }}
          />
        </div>
        <p className="mt-1 text-[10.5px] text-faint">
          {formatBytes(result.tokenEstimate.inputBytes)} in · {formatBytes(result.tokenEstimate.outputBytes)} out
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {Array.from(counts.entries()).map(([outcome, count]) => (
          <span
            key={outcome}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-elevated px-2 py-0.5 text-[10.5px] text-muted"
          >
            <span className="tabular-nums font-medium text-foreground">{count}</span>
            {OUTCOME_LABEL[outcome]}
          </span>
        ))}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1">
        <ul className="space-y-1.5">
          {result.coverage.map((row) => (
            <li key={row.id} className="rounded-lg border border-border/70 bg-elevated/50 px-2 py-1.5">
              <div className="flex items-start gap-1.5">
                <KindIcon category={row.category} className="mt-0.5 text-faint" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground" title={row.label}>
                  {row.label}
                </span>
                <OutcomeChip outcome={row.outcome} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[10.5px] text-faint">
                <span className="font-mono">{row.kind}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{formatBytes(row.size)}</span>
                {row.depth > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">depth {row.depth}</span>
                  </>
                )}
                {row.hash && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{row.hash.slice(0, 8)}…</span>
                  </>
                )}
              </div>
              {row.reason && <p className="mt-1 text-[10.5px] leading-relaxed text-warning">{row.reason}</p>}
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-border pt-3">
        <h3 className="text-[10.5px] font-medium tracking-wide text-faint uppercase">Enforced budgets</h3>
        <ul className="mt-1.5 space-y-0.5 text-[10.5px] leading-relaxed text-muted">
          <li>Per file ≤ {formatBytes(BUDGETS.maxFileBytes)}</li>
          <li>Per archive member ≤ {formatBytes(BUDGETS.maxMemberBytes)} (checked during decompression)</li>
          <li>Total inflated ≤ {formatBytes(BUDGETS.maxTotalInflatedBytes)}</li>
          <li>
            Members ≤ {BUDGETS.maxMemberCount} · depth ≤ {BUDGETS.maxDepth} · ratio ≤{' '}
            {BUDGETS.maxCompressionRatio}:1
          </li>
          <li>
            Per archive ≤ {BUDGETS.archiveWallMs / 1000}s · whole scan ≤ {BUDGETS.totalScanMs / 1000}s
          </li>
        </ul>
      </div>

      <div className="border-t border-border pt-3">
        <h3 className="text-[10.5px] font-medium tracking-wide text-faint uppercase">
          Limitations {result.limitations.length > 0 ? `(${result.limitations.length})` : ''}
        </h3>
        {result.limitations.length === 0 ? (
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">
            None recorded — every source reached a clean outcome within budget.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1 text-[10.5px] leading-relaxed text-warning">
            {result.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
