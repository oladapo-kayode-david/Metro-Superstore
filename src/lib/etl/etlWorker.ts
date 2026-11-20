import { runCleaningPipeline, type CleaningOptions, type DetectedTables } from './cleaningPipeline';

interface WorkerRequest {
  detected: DetectedTables;
  options: Omit<CleaningOptions, 'onProgress'>;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const { detected, options } = event.data;
    const output = runCleaningPipeline(detected, {
      ...options,
      onProgress: (pct, stage) => {
        self.postMessage({ type: 'progress', pct, stage });
      },
    });
    self.postMessage({ type: 'done', output });
  } catch (err) {
    self.postMessage({
      type: 'error',
      error: err instanceof Error ? err.message : 'ETL worker failed',
    });
  }
};
