import { useState } from 'react';
import { OUTCOME_LABEL } from '../lib/constants';
import { estimateTokens, formatBytes } from '../lib/util';
import type { ScanResult } from '../types';
import { MarkdownView } from './MarkdownView';
import { AlertIcon, CheckIcon, CopyIcon, DownloadIcon, LayersIcon, ScanIcon } from './Icons';

interface ResultPanelProps {
  result: ScanResult | null;
  scanning: boolean;
  hasInputs: boolean;
  progressStage: string;
  progressDone: number;
  progressTotal: number;
}

export function ResultPanel({
  result,
  scanning,
  hasInputs,
  progressStage,
  progressDone,
  progressTotal,
}: ResultPanelProps) {
  const [copied, setCopied] = useState(false);

  const download = () => {
    if (!result) return;
    const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'OneShot-Context.md';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const ratio = progressTotal > 0 ? Math.min(1, progressDone / progressTotal) : 0;

  return (
    <section
      aria-label="Generated document"
      className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2.5">
        <LayersIcon className="size-4 shrink-0 text-primary" />
        <h2 className="mr-auto font-mono text-[12.5px] font-semibold text-foreground">OneShot-Context.md</h2>

        {result && (
          <span className="text-[11px] tabular-nums text-faint">
            ~{result.tokenEstimate.outputTokens.toLocaleString()} tok out ·{' '}
            {formatBytes(result.tokenEstimate.outputBytes)}
          </span>
        )}

        <button
          type="button"
          onClick={copy}
          disabled={!result}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-elevated px-2 py-1.5 text-[11.5px] font-medium text-foreground transition-colors duration-150 hover:border-primary/50 hover:bg-primary/5 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {copied ? <CheckIcon className="size-3.5 text-success" /> : <CopyIcon className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>

        <button
          type="button"
          onClick={download}
          disabled={!result}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-[11.5px] font-semibold text-on-primary transition-colors duration-150 hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <DownloadIcon className="size-3.5" />
          Download .md
        </button>
      </header>

      {scanning && (
        <div className="border-b border-border px-3.5 py-3" aria-live="polite" aria-atomic="true">
          <p className="text-[12px] text-foreground">{progressStage || 'Reading sources…'}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elevated" role="presentation">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${Math.max(6, ratio * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] tabular-nums text-faint">
            {progressDone} of {progressTotal} source{progressTotal === 1 ? '' : 's'}
          </p>
        </div>
      )}

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!result && !scanning && (
          <div className="mx-auto flex max-w-md flex-col items-center py-14 text-center">
            <span className="flex size-11 items-center justify-center rounded-full border border-border bg-elevated">
              <ScanIcon className="size-5 text-faint" />
            </span>
            <h3 className="mt-3 text-[14px] font-semibold text-foreground">
              {hasInputs ? 'Ready when you are' : 'Your consolidated context appears here'}
            </h3>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
              {hasInputs
                ? 'Hit Scan → Consolidate. Everything readable in your sources is merged into one file, and anything that could not be read is named honestly.'
                : 'Add your current question, then drop files or paste text on the left. One scan produces a single OneShot-Context.md you can hand to any other agent.'}
            </p>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div
              className={`os-fade-up flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${
                result.finalOutcome === 'completed'
                  ? 'border-success/35 bg-success/10'
                  : 'border-warning/40 bg-warning/10'
              }`}
            >
              {result.finalOutcome === 'completed' ? (
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
              ) : (
                <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
              )}
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-foreground">
                  {result.finalOutcome === 'completed'
                    ? 'Consolidated — every source read cleanly'
                    : `Consolidated with limitations (${OUTCOME_LABEL.partial.toLowerCase()})`}
                </p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
                  {result.nodes.length} source{result.nodes.length === 1 ? '' : 's'} inspected in{' '}
                  {(result.durationMs / 1000).toFixed(1)}s. {result.limitations.length > 0
                    ? `${result.limitations.length} limitation${result.limitations.length === 1 ? '' : 's'} recorded — see the coverage panel.`
                    : 'No limitations were recorded.'}
                </p>
              </div>
            </div>

            <p className="text-[11px] text-faint">
              Rendered preview · ~{estimateTokens(result.tokenEstimate.outputBytes).toLocaleString()} estimated tokens
            </p>

            <MarkdownView markdown={result.markdown} />
          </div>
        )}
      </div>
    </section>
  );
}
