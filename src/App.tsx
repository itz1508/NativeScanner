import { InputsPanel } from './components/InputsPanel';
import { ResultPanel } from './components/ResultPanel';
import { CoveragePanel } from './components/CoveragePanel';
import { useScan } from './hooks/useScan';

export default function App() {
  const scan = useScan();
  const scanning = scan.progress.phase === 'scanning';
  const canScan = scan.inputs.length > 0 && !scanning;

  const statusText = scanning
    ? scan.progress.stage || 'Working…'
    : scan.progress.phase === 'idle'
      ? scan.inputs.length === 0
        ? 'Add at least one source to begin.'
        : 'Ready to consolidate.'
      : scan.progress.stage;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border/80 bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1800px] flex-wrap items-center gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-gradient-to-br from-primary/10 to-primary/5 shadow-sm">
              <svg className="size-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </span>
            <div className="min-w-0">
              <h1 className="text-[15px] leading-tight font-bold tracking-tight text-foreground">OneShot</h1>
              <p className="truncate text-[11.5px] text-muted">
                Multi-source consolidation · entirely local
              </p>
            </div>
          </div>

          <div className="mr-auto" />

          <p
            aria-live="polite"
            aria-atomic="true"
            className="hidden max-w-[45ch] truncate text-[12px] text-muted lg:block"
          >
            {statusText}
          </p>

          <div className="flex items-center gap-2">
            {scanning && (
              <button
                type="button"
                onClick={scan.cancel}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border/60 bg-elevated/50 px-4 py-2.5 text-[12.5px] font-medium text-foreground transition-all duration-200 hover:border-danger/60 hover:bg-danger/5 hover:text-danger active:scale-[0.96]"
              >
                <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
                Cancel
              </button>
            )}

            <button
              type="button"
              onClick={() => void scan.scan()}
              disabled={!canScan}
              className="inline-flex cursor-pointer items-center gap-2.5 rounded-xl bg-primary px-5 py-2.5 text-[13px] font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:opacity-90 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              <svg className="size-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Scan → Consolidate
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1800px] flex-1 grid-cols-1 gap-5 p-6 xl:h-[calc(100dvh-5.5rem)] xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)_minmax(0,22rem)] xl:overflow-hidden">
        <InputsPanel
          intent={scan.intent}
          inputs={scan.inputs}
          result={scan.result}
          baselineId={scan.baselineId}
          softTokenTarget={scan.softTokenTarget}
          onIntent={scan.updateIntent}
          onTarget={scan.updateTarget}
          onFiles={scan.addFiles}
          onAddPaste={scan.addPaste}
          onBaseline={scan.chooseBaseline}
          onHint={scan.updateHint}
          onRemove={scan.removeInput}
          onPasteChange={scan.updatePaste}
          onClear={scan.clearAll}
        />

        <ResultPanel
          result={scan.result}
          scanning={scanning}
          hasInputs={scan.inputs.length > 0}
          progressStage={scan.progress.stage}
          progressDone={scan.progress.done}
          progressTotal={scan.progress.total}
        />

        <CoveragePanel result={scan.result} inputCount={scan.inputs.length} />
      </main>

      <footer className="border-t border-border/80 px-6 py-4">
        <p className="mx-auto max-w-[1800px] text-[11.5px] text-faint">
          <span className="font-medium text-muted">Privacy-first:</span> Nothing is uploaded and nothing leaves this tab. Archives are decoded in a sandboxed worker under hard resource budgets, and every limitation is reported rather than hidden.
        </p>
      </footer>
    </div>
  );
}
