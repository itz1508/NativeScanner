import { CoveragePanel } from './components/CoveragePanel';
import { InputsPanel } from './components/InputsPanel';
import { LayersIcon, ScanIcon, StopIcon } from './components/Icons';
import { ResultPanel } from './components/ResultPanel';
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
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-elevated">
            <LayersIcon className="size-4 text-primary" />
          </span>

          <div className="mr-auto min-w-0">
            <h1 className="text-[14px] leading-tight font-semibold tracking-tight text-foreground">OneShot</h1>
            <p className="truncate text-[11.5px] text-muted">
              Many mixed sources in, one standalone context file out — deterministic, and entirely in this tab.
            </p>
          </div>

          <p
            aria-live="polite"
            aria-atomic="true"
            className="hidden max-w-[42ch] truncate text-[11.5px] text-muted lg:block"
          >
            {statusText}
          </p>

          {scanning && (
            <button
              type="button"
              onClick={scan.cancel}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-2 text-[12px] font-medium text-foreground transition-colors duration-150 hover:border-danger/50 hover:text-danger active:scale-[0.97]"
            >
              <StopIcon className="size-3.5" />
              Cancel
            </button>
          )}

          <button
            type="button"
            onClick={() => void scan.scan()}
            disabled={!canScan}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[12.5px] font-semibold text-on-primary shadow-sm transition-all duration-150 hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ScanIcon className="size-4" />
            Scan → Consolidate
          </button>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1600px] flex-1 grid-cols-1 gap-4 p-4 xl:h-[calc(100dvh-4.6rem)] xl:grid-cols-[minmax(0,23rem)_minmax(0,1fr)_minmax(0,20rem)] xl:overflow-hidden">
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

      <footer className="border-t border-border px-4 py-3">
        <p className="mx-auto max-w-[1600px] text-[11px] text-faint">
          Nothing is uploaded and nothing leaves this tab. There is no model, no vision and no server: archives are
          decoded in a sandboxed worker under hard resource budgets, and every limitation is reported rather than
          hidden.
        </p>
      </footer>
    </div>
  );
}
