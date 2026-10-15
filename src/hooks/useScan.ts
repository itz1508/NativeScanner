import { useCallback, useRef, useState } from 'react';
import { ArchiveWorkerClient } from '../lib/archiveClient';
import { DEFAULT_SOFT_TOKEN_TARGET } from '../lib/constants';
import { ScanCancelledError, createFileInput, createPasteInput, runScan } from '../lib/pipeline';
import type { InputItem, ScanResult } from '../types';

export interface ScanProgressState {
  phase: 'idle' | 'scanning' | 'done' | 'error';
  stage: string;
  done: number;
  total: number;
}

const IDLE: ScanProgressState = { phase: 'idle', stage: '', done: 0, total: 0 };

export function useScan() {
  const [intent, setIntent] = useState('');
  const [inputs, setInputs] = useState<InputItem[]>([]);
  const [baselineId, setBaselineId] = useState<string | undefined>(undefined);
  const [softTokenTarget, setSoftTokenTarget] = useState<number>(DEFAULT_SOFT_TOKEN_TARGET);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [progress, setProgress] = useState<ScanProgressState>(IDLE);

  const clientRef = useRef<ArchiveWorkerClient | null>(null);
  const cancelledRef = useRef(false);
  const pasteCounter = useRef(0);

  /** Any edit to the inputs invalidates a previously produced document. */
  const invalidate = useCallback(() => {
    setResult(null);
    setProgress(IDLE);
  }, []);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const items = Array.from(files).map(createFileInput);
      if (items.length === 0) return;
      setInputs((previous) => [...previous, ...items]);
      invalidate();
    },
    [invalidate],
  );

  const addPaste = useCallback(() => {
    pasteCounter.current += 1;
    const item = createPasteInput('', pasteCounter.current);
    // Give new pastes a unique, stable display name.
    item.name = `Pasted block ${pasteCounter.current}`;
    setInputs((previous) => [...previous, item]);
    invalidate();
  }, [invalidate]);

  const updatePaste = useCallback(
    (id: string, text: string) => {
      setInputs((previous) =>
        previous.map((item) =>
          item.id === id
            ? { ...item, pasteText: text, size: new TextEncoder().encode(text).length }
            : item,
        ),
      );
      invalidate();
    },
    [invalidate],
  );

  const updateHint = useCallback(
    (id: string, hint: string) => {
      setInputs((previous) => previous.map((item) => (item.id === id ? { ...item, hint } : item)));
      invalidate();
    },
    [invalidate],
  );

  const removeInput = useCallback(
    (id: string) => {
      setInputs((previous) => previous.filter((item) => item.id !== id));
      setBaselineId((current) => (current === id ? undefined : current));
      invalidate();
    },
    [invalidate],
  );

  const clearAll = useCallback(() => {
    setInputs([]);
    setIntent('');
    setBaselineId(undefined);
    pasteCounter.current = 0;
    invalidate();
  }, [invalidate]);

  const chooseBaseline = useCallback(
    (id: string | undefined) => {
      setBaselineId((current) => (current === id ? undefined : id));
      invalidate();
    },
    [invalidate],
  );

  const updateIntent = useCallback(
    (value: string) => {
      setIntent(value);
      invalidate();
    },
    [invalidate],
  );

  const updateTarget = useCallback(
    (value: number) => {
      setSoftTokenTarget(Number.isFinite(value) && value > 0 ? Math.round(value) : DEFAULT_SOFT_TOKEN_TARGET);
      invalidate();
    },
    [invalidate],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    clientRef.current?.terminate();
    clientRef.current = null;
    setProgress({ phase: 'idle', stage: 'Cancelled — nothing was produced.', done: 0, total: 0 });
  }, []);

  const scan = useCallback(async () => {
    if (inputs.length === 0) return;
    cancelledRef.current = false;
    const client = new ArchiveWorkerClient();
    clientRef.current = client;
    setProgress({ phase: 'scanning', stage: 'Starting', done: 0, total: inputs.length });

    try {
      const scanResult = await runScan(
        { intent, inputs, baselineId, softTokenTarget },
        client,
        (update) => setProgress({ phase: 'scanning', stage: update.stage, done: update.done, total: update.total }),
        () => cancelledRef.current,
      );
      setResult(scanResult);
      setProgress({
        phase: 'done',
        stage: `Consolidated ${scanResult.nodes.length} source${scanResult.nodes.length === 1 ? '' : 's'}.`,
        done: inputs.length,
        total: inputs.length,
      });
    } catch (error) {
      if (error instanceof ScanCancelledError) {
        setResult(null);
        setProgress({ phase: 'idle', stage: 'Cancelled — nothing was produced.', done: 0, total: 0 });
      } else {
        setResult(null);
        // Surface a human message rather than a raw error.
        setProgress({
          phase: 'error',
          stage: `We couldn't finish that scan — ${
            error instanceof Error ? error.message : 'something went wrong'
          }. Your inputs are untouched; try again.`,
          done: 0,
          total: 0,
        });
      }
    } finally {
      client.terminate();
      clientRef.current = null;
    }
  }, [inputs, intent, baselineId, softTokenTarget]);

  return {
    intent,
    inputs,
    baselineId,
    softTokenTarget,
    result,
    progress,
    addFiles,
    addPaste,
    updatePaste,
    updateHint,
    removeInput,
    clearAll,
    chooseBaseline,
    updateIntent,
    updateTarget,
    scan,
    cancel,
  };
}

export type ScanController = ReturnType<typeof useScan>;
