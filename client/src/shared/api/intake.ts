import { IMPORT_PATH, OBRAS_PATH } from '../config/protocol';
import { consumeImportStream } from './import-stream';

const HTTP_OK_MIN = 200;
const HTTP_REDIRECTION_MIN = 300;
const NETWORK_FAILURE_STATUS = 0;

/** Failure during master upload or import with the corresponding HTTP status code (0 for network drop or abort). */
export class IntakeError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`intake http ${status}`);
    this.name = 'IntakeError';
    this.status = status;
  }
}

export type ImportProgress =
  | { phase: 'downloading'; received: number; total: number | null }
  | { phase: 'copying' };

function makeAbortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

/** Streams a master file directly from disk using an XMLHttpRequest PUT request. */
export function uploadMaster(
  file: File,
  onProgress: (sent: number, total: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(makeAbortError());
      return;
    }

    const xhr = new XMLHttpRequest();
    const url = `${OBRAS_PATH}${encodeURIComponent(file.name)}`;
    xhr.open('PUT', url);

    let settled = false;

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      xhr.onload = null;
      xhr.onerror = null;
      xhr.onabort = null;
      if (xhr.upload) {
        xhr.upload.onprogress = null;
      }
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      xhr.abort();
      reject(makeAbortError());
    };

    signal.addEventListener('abort', onAbort);

    if (xhr.upload) {
      xhr.upload.onprogress = (e: ProgressEvent) => {
        onProgress(e.loaded, e.total);
      };
    }

    xhr.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (xhr.status >= HTTP_OK_MIN && xhr.status < HTTP_REDIRECTION_MIN) {
        resolve();
      } else {
        reject(new IntakeError(xhr.status));
      }
    };

    xhr.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new IntakeError(NETWORK_FAILURE_STATUS));
    };

    xhr.onabort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(signal.aborted ? makeAbortError() : new IntakeError(NETWORK_FAILURE_STATUS));
    };

    xhr.send(file);
  });
}

/** Requests server intake from a remote link or a server-local disk path. */
export async function importSource(
  text: string,
  signal: AbortSignal,
  onProgress?: (progress: ImportProgress) => void,
): Promise<void> {
  const res = await fetch(IMPORT_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      Accept: 'application/x-ndjson',
    },
    body: text.trim(),
    signal,
  });
  if (!res.ok) {
    throw new IntakeError(res.status);
  }
  const contentType = res.headers?.get?.('content-type') ?? '';
  if (!contentType.includes('application/x-ndjson')) {
    return;
  }
  if (!res.body) {
    throw new IntakeError(NETWORK_FAILURE_STATUS);
  }
  await consumeImportStream(res.body, signal, onProgress);
}
