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
      className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-br from-surface to-surface/50 shadow-sm"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border/80 px-4 py-3">
        <LayersIcon className="size-4.5 shrink-0 text-primary" />
        <h2 className="mr-auto font-mono text-[13px] font-semibold text-foreground">OneShot-Context.md</h2>

        {result && (
          <span className="text-[11.5px] tabular-nums text-faint">
            ~{result.tokenEstimate.outputTokens.toLocaleString()} tok out ·{' '}
            {formatBytes(result.tokenEstimate.outputBytes)}
          </span>
        )}

        <button
          type="button"
          onClick={copy}
          disabled={!result}
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border/60 bg-elevated/50 px-3 py-2 text-[11.5px] font-medium text-foreground transition-all duration-200 hover:border-primary/50 hover:bg-primary/5 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {copied ? <CheckIcon className="size-4 text-success" /> : <CopyIcon className="size-4" />}
          {copied ? 'Copied' : 'Copy'}
        </button>

        <button
          type="button"
          onClick={download}
          disabled={!result}
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 py-2 text-[11.5px] font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:opacity-90 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          <DownloadIcon className="size-4" />
          Download .md
        </button>
      </header>

      {scanning && (
        <div className="border-b border-border/80 px-4 py-3.5" aria-live="polite" aria-atomic="true">
          <p className="text-[12.5px] font-medium text-foreground">{progressStage || 'Reading sources…'}</p>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-elevated/50" role="presentation">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${Math.max(6, ratio * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-[11.5px] tabular-nums text-faint">
            {progressDone} of {progressTotal} source{progressTotal === 1 ? '' : 's'}
          </p>
        </div>
      )}

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {!result && !scanning && (
          <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-full border border-border/60 bg-elevated/50">
              <ScanIcon className="size-5.5 text-faint" />
            </span>
            <h3 className="mt-4 text-[15px] font-semibold text-foreground">
              {hasInputs ? 'Ready when you are' : 'Your consolidated context appears here'}
            </h3>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
              {hasInputs
                ? 'Hit Scan → Consolidate. Everything readable in your sources is merged into one file, and anything that could not be read is named honestly.'
                : 'Add your current question, then drop files or paste text on the left. One scan produces a single OneShot-Context.md you can hand to any other agent.'}
            </p>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div
              className={`os-fade-up flex items-start gap-3 rounded-xl border px-4 py-3 ${
                result.finalOutcome === 'completed'
                  ? 'border-success/40 bg-success/10'
                  : 'border-warning/50 bg-warning/10'
              }`}
            >
              {result.finalOutcome === 'completed' ? (
                <CheckIcon className="mt-0.5 size-5 shrink-0 text-success" />
              ) : (
                <AlertIcon className="mt-0.5 size-5 shrink-0 text-warning" />
              )}
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-foreground">
                  {result.finalOutcome === 'completed'
                    ? 'Consolidated — every source read cleanly'
                    : `Consolidated with limitations (${OUTCOME_LABEL.partial.toLowerCase()})`}
                </p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                  {result.nodes.length} source{result.nodes.length === 1 ? '' : 's'} inspected in{' '}
                  {(result.durationMs / 1000).toFixed(1)}s. {result.limitations.length > 0
                    ? `${result.limitations.length} limitation${result.limitations.length === 1 ? '' : 's'} recorded — see the coverage panel.`
                    : 'No limitations were recorded.'}
                </p>
              </div>
            </div>

            <p className="text-[11.5px] text-faint">
              Rendered preview · ~{estimateTokens(result.tokenEstimate.outputBytes).toLocaleString()} estimated tokens
            </p>

            <MarkdownView markdown={result.markdown} />
          </div>
        )}
      </div>
    </section>
  );
}
