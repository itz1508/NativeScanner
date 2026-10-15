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
      <div className="rounded-xl border border-border bg-surface p-3.5">
        <label htmlFor="oneshot-intent" className="block text-[11px] font-medium tracking-wide text-faint uppercase">
          Current question / intent
        </label>
        <textarea
          id="oneshot-intent"
          value={intent}
          onChange={(event) => onIntent(event.target.value)}
          rows={3}
          placeholder="What are you actually trying to answer? e.g. “What is the current release scope and what changed since v2?”"
          className="scroll-thin mt-2 w-full resize-y rounded-lg border border-border bg-elevated px-3 py-2 text-[13px] leading-relaxed text-foreground placeholder:text-faint focus:border-primary focus:outline-none"
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          Everything below is organised around this question. Leave it blank and the document falls back to source
          order.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-3.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[11px] font-medium tracking-wide text-faint uppercase">Add sources</h2>
          <button
            type="button"
            onClick={onClear}
            disabled={inputs.length === 0 && !intent}
            className="cursor-pointer rounded-md px-1.5 py-1 text-[11px] text-faint transition-colors duration-150 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
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
          className={`mt-2 block cursor-pointer rounded-lg border border-dashed px-3 py-5 text-center transition-colors duration-150 ${
            dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-elevated'
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
          <FileIcon className="mx-auto size-5 text-faint" />
          <span className="mt-2 block text-[12.5px] font-medium text-foreground">
            Drop files here, or click to browse
          </span>
          <span className="mt-1 block text-[11px] leading-relaxed text-muted">
            Text, code, JSON/YAML/TOML/XML/CSV, ZIP/TAR/TGZ (nested too), and PNG/JPEG/WebP.
          </span>
        </label>

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onAddPaste}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors duration-150 hover:border-primary/50 hover:bg-primary/5 active:scale-[0.97]"
          >
            <PlusIcon className="size-3.5" />
            Add paste block
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5">
        <label htmlFor="oneshot-target" className="text-[11px] font-medium tracking-wide text-faint uppercase">
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
            className="w-24 rounded-md border border-border bg-elevated px-2 py-1 text-right text-[12px] tabular-nums text-foreground focus:border-primary focus:outline-none"
          />
          <span className="text-[11px] text-muted">tokens</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-surface p-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-medium tracking-wide text-faint uppercase">Source registry</h2>
          <span className="text-[11px] tabular-nums text-faint">{inputs.length} registered</span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          Select the radio button to mark a <strong className="font-medium text-foreground">baseline</strong> — it
          overrides filename and version-number guesses.
        </p>
        <div className="scroll-thin mt-2.5 min-h-0 flex-1 overflow-y-auto pr-1">
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
