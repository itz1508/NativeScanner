import { useRef, useState, type DragEvent } from 'react';
import type { InputItem, ScanResult } from '../types';
import { FileIcon, PlusIcon } from './Icons';
import { SourceRegistry } from './SourceRegistry';

interface InputsPanelProps {
  intent: string;
  inputs: InputItem[];
  result: ScanResult | null;
  baselineId?: string;
  softTokenTarget: number;
  onIntent: (value: string) => void;
  onTarget: (value: number) => void;
  onFiles: (files: FileList | File[]) => void;
  onAddPaste: () => void;
  onBaseline: (id: string) => void;
  onHint: (id: string, hint: string) => void;
  onRemove: (id: string) => void;
  onPasteChange: (id: string, text: string) => void;
  onClear: () => void;
}

export function InputsPanel({
  intent,
  inputs,
  result,
  baselineId,
  softTokenTarget,
  onIntent,
  onTarget,
  onFiles,
  onAddPaste,
  onBaseline,
  onHint,
  onRemove,
  onPasteChange,
  onClear,
}: InputsPanelProps) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (event.dataTransfer?.files?.length) onFiles(event.dataTransfer.files);
  };

  return (
    <section aria-label="Inputs and source registry" className="flex min-h-0 flex-col gap-4">
      <div className="rounded-2xl border border-border/80 bg-gradient-to-br from-surface to-surface/50 p-4 shadow-sm">
        <label htmlFor="oneshot-intent" className="block text-[11px] font-semibold tracking-wide text-faint uppercase">
          Current question / intent
        </label>
        <textarea
          id="oneshot-intent"
          value={intent}
          onChange={(event) => onIntent(event.target.value)}
          rows={3}
          placeholder="What are you actually trying to answer? e.g. 'What is the current release scope and what changed since v2?'"
          className="scroll-thin mt-2.5 w-full resize-y rounded-xl border border-border/60 bg-elevated/50 px-4 py-3 text-[13.5px] leading-relaxed text-foreground placeholder:text-faint focus:border-primary/80 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-200"
        />
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
          Everything below is organised around this question. Leave it blank and the document falls back to source
          order.
        </p>
      </div>

      <div className="rounded-2xl border border-border/80 bg-gradient-to-br from-surface to-surface/50 p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[11px] font-semibold tracking-wide text-faint uppercase">Add sources</h2>
          <button
            type="button"
            onClick={onClear}
            disabled={inputs.length === 0 && !intent}
            className="cursor-pointer rounded-lg px-2 py-1 text-[11px] font-medium text-faint transition-all duration-200 hover:text-danger hover:bg-danger/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear all
          </button>
        </div>

        <label
          onDragEnter={(event) => {
            event.preventDefault();
            dragDepth.current += 1;
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault();
            dragDepth.current -= 1;
            if (dragDepth.current <= 0) {
              dragDepth.current = 0;
              setDragging(false);
            }
          }}
          onDrop={handleDrop}
          className={`mt-3 block cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition-all duration-200 ${
            dragging ? 'border-primary bg-primary/10' : 'border-border/60 hover:border-primary/50 hover:bg-elevated/30'
          }`}
        >
          <input
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              if (event.target.files?.length) onFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <FileIcon className="mx-auto size-6 text-faint" />
          <span className="mt-2.5 block text-[13px] font-semibold text-foreground">
            Drop files here, or click to browse
          </span>
          <span className="mt-1.5 block text-[11.5px] leading-relaxed text-muted">
            Text, code, JSON/YAML/TOML/XML/CSV, ZIP/TAR/TGZ (nested too), and PNG/JPEG/WebP.
          </span>
        </label>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={onAddPaste}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border/60 bg-elevated/50 px-3 py-2 text-[12.5px] font-medium text-foreground transition-all duration-200 hover:border-primary/50 hover:bg-primary/5 active:scale-[0.97]"
          >
            <PlusIcon className="size-4" />
            Add paste block
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/80 bg-gradient-to-br from-surface to-surface/50 px-4 py-3 shadow-sm">
        <label htmlFor="oneshot-target" className="text-[11px] font-semibold tracking-wide text-faint uppercase">
          Soft token target
        </label>
        <div className="flex items-center gap-2">
          <input
            id="oneshot-target"
            type="number"
            min={200}
            step={100}
            value={softTokenTarget}
            onChange={(event) => onTarget(Number(event.target.value))}
            className="w-28 rounded-lg border border-border/60 bg-elevated/50 px-3 py-2 text-right text-[12.5px] tabular-nums text-foreground focus:border-primary/80 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-200"
          />
          <span className="text-[11.5px] text-muted">tokens</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-border/80 bg-gradient-to-br from-surface to-surface/50 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold tracking-wide text-faint uppercase">Source registry</h2>
          <span className="text-[11.5px] tabular-nums text-faint font-medium">{inputs.length} registered</span>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
          Select the radio button to mark a <strong className="font-semibold text-foreground">baseline</strong> — it
          overrides filename and version-number guesses.
        </p>
        <div className="scroll-thin mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          <SourceRegistry
            inputs={inputs}
            result={result}
            baselineId={baselineId}
            onBaseline={onBaseline}
            onHint={onHint}
            onRemove={onRemove}
            onPasteChange={onPasteChange}
          />
        </div>
      </div>
    </section>
  );
}
