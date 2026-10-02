import { IntakeError, type ImportProgress } from './intake';

const NETWORK_FAILURE_STATUS = 0;

interface ImportNdjsonLine {
  fase?: string;
  recibido?: number;
  total?: number | null;
  nombre?: string;
  error?: string;
  codigo?: number;
}

function processLine(
  line: string,
  onProgress?: (progress: ImportProgress) => void,
): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const parsed = JSON.parse(trimmed) as ImportNdjsonLine;
  if (parsed.error !== undefined || parsed.codigo !== undefined) {
    const code = typeof parsed.codigo === 'number' ? parsed.codigo : NETWORK_FAILURE_STATUS;
    throw new IntakeError(code);
  }
  if (typeof parsed.nombre === 'string') {
    return true;
  }
  if (parsed.fase === 'descargando') {
    const total =
      parsed.total === -1 || parsed.total === null || parsed.total === undefined
        ? null
        : Number(parsed.total);
    onProgress?.({
      phase: 'downloading',
      received: Number(parsed.recibido ?? 0),
      total,
    });
  } else if (parsed.fase === 'copiando') {
    onProgress?.({ phase: 'copying' });
  }
  return false;
}

export async function consumeImportStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onProgress?: (progress: ImportProgress) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal.aborted) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        if (processLine(line, onProgress)) {
          return;
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      if (processLine(buffer, onProgress)) {
        return;
      }
    }
  } finally {
    reader.releaseLock?.();
  }

  if (signal.aborted) {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  }

  throw new IntakeError(NETWORK_FAILURE_STATUS);
}
