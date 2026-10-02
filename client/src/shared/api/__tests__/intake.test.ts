import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_PATH, OBRAS_PATH } from '@/shared/config/protocol';
import { importSource, IntakeError, uploadMaster, type ImportProgress } from '../intake';

class FakeUpload {
  onprogress: ((ev: { loaded: number; total: number }) => void) | null = null;
}

class FakeXMLHttpRequest {
  static last: FakeXMLHttpRequest | null = null;
  method = '';
  url = '';
  status = 200;
  body: unknown = null;
  upload = new FakeUpload();
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;

  constructor() {
    FakeXMLHttpRequest.last = this;
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  send(body?: unknown): void {
    this.body = body;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }
}

function createChunkStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(enc.encode(chunk));
      }
      controller.close();
    },
  });
}

beforeEach(() => {
  FakeXMLHttpRequest.last = null;
  vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('uploadMaster', () => {
  it('feeds progress callback with loaded and total', async () => {
    const file = new File(['bits'], 'canvas.png', { type: 'image/png' });
    const onProgress = vi.fn();
    const controller = new AbortController();

    const uploadPromise = uploadMaster(file, onProgress, controller.signal);
    const xhr = FakeXMLHttpRequest.last;
    expect(xhr).not.toBeNull();

    xhr?.upload.onprogress?.({ loaded: 1024, total: 4096 });
    expect(onProgress).toHaveBeenCalledWith(1024, 4096);

    if (xhr) {
      xhr.status = 200;
      xhr.onload?.();
    }
    await expect(uploadPromise).resolves.toBeUndefined();
  });

  it('resolves on 202 and puts encoded filename to OBRAS_PATH', async () => {
    const file = new File(['bits'], 'grand master #1.png', { type: 'image/png' });
    const onProgress = vi.fn();
    const controller = new AbortController();

    const uploadPromise = uploadMaster(file, onProgress, controller.signal);
    const xhr = FakeXMLHttpRequest.last;
    expect(xhr?.method).toBe('PUT');
    expect(xhr?.url).toBe(`${OBRAS_PATH}grand%20master%20%231.png`);
    expect(xhr?.body).toBe(file);

    if (xhr) {
      xhr.status = 202;
      xhr.onload?.();
    }
    await expect(uploadPromise).resolves.toBeUndefined();
  });

  it('rejects with IntakeError status 415 on unsupported image format', async () => {
    const file = new File(['bad'], 'unknown.xyz');
    const onProgress = vi.fn();
    const controller = new AbortController();

    const uploadPromise = uploadMaster(file, onProgress, controller.signal);
    const xhr = FakeXMLHttpRequest.last;
    if (xhr) {
      xhr.status = 415;
      xhr.onload?.();
    }

    await expect(uploadPromise).rejects.toSatisfy((err: unknown) => {
      return err instanceof IntakeError && err.status === 415;
    });
  });

  it('rejects with IntakeError status 0 on network error', async () => {
    const file = new File(['data'], 'test.png');
    const onProgress = vi.fn();
    const controller = new AbortController();

    const uploadPromise = uploadMaster(file, onProgress, controller.signal);
    const xhr = FakeXMLHttpRequest.last;
    xhr?.onerror?.();

    await expect(uploadPromise).rejects.toSatisfy((err: unknown) => {
      return err instanceof IntakeError && err.status === 0;
    });
  });

  it('calls xhr.abort and rejects with AbortError when signal is aborted', async () => {
    const file = new File(['data'], 'test.png');
    const onProgress = vi.fn();
    const controller = new AbortController();

    const uploadPromise = uploadMaster(file, onProgress, controller.signal);
    const xhr = FakeXMLHttpRequest.last;

    controller.abort();
    expect(xhr?.aborted).toBe(true);

    await expect(uploadPromise).rejects.toSatisfy((err: unknown) => {
      return err instanceof Error && err.name === 'AbortError';
    });
  });

  it('rejects immediately with AbortError if signal is already aborted', async () => {
    const file = new File(['data'], 'test.png');
    const onProgress = vi.fn();
    const controller = new AbortController();
    controller.abort();

    await expect(uploadMaster(file, onProgress, controller.signal)).rejects.toSatisfy((err: unknown) => {
      return err instanceof Error && err.name === 'AbortError';
    });
    expect(FakeXMLHttpRequest.last).toBeNull();
  });
});

describe('importSource', () => {
  it('posts trimmed text to IMPORT_PATH and sends Accept application/x-ndjson', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await importSource('   /disk/masters/grand.psb   \n', controller.signal);
    expect(fetchMock).toHaveBeenCalledWith(IMPORT_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        Accept: 'application/x-ndjson',
      },
      body: '/disk/masters/grand.psb',
      signal: controller.signal,
    });
  });

  it('handles ndjson stream split across chunks in the middle of a line', async () => {
    const stream = createChunkStream([
      '{"fase":"descargando","recibido":50,"tot',
      'al":100}\n{"fase":"descargando","recibido":100,"total":-1}\n',
      '{"nombre":"grand.psb","modo":"descarga"}\n',
    ]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/x-ndjson' }),
      body: stream,
    });
    vi.stubGlobal('fetch', fetchMock);
    const progressCalls: ImportProgress[] = [];
    const controller = new AbortController();

    await importSource('/disk/masters/grand.psb', controller.signal, (p) => progressCalls.push(p));

    expect(progressCalls).toEqual([
      { phase: 'downloading', received: 50, total: 100 },
      { phase: 'downloading', received: 100, total: null },
    ]);
  });

  it('throws IntakeError with codigo on an error line', async () => {
    const stream = createChunkStream([
      '{"fase":"descargando","recibido":10,"total":100}\n{"error":"conflict","codigo":409}\n',
    ]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/x-ndjson' }),
      body: stream,
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(importSource('/remote/art.tiff', controller.signal)).rejects.toSatisfy((err: unknown) => {
      return err instanceof IntakeError && err.status === 409;
    });
  });

  it('throws IntakeError(0) if the stream ends without a final line', async () => {
    const stream = createChunkStream([
      '{"fase":"descargando","recibido":10,"total":100}\n',
    ]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/x-ndjson' }),
      body: stream,
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(importSource('/remote/art.tiff', controller.signal)).rejects.toSatisfy((err: unknown) => {
      return err instanceof IntakeError && err.status === 0;
    });
  });

  it('resolves on a plain 202 JSON answer without ndjson', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: null,
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(importSource('/remote/legacy.png', controller.signal)).resolves.toBeUndefined();
  });

  it('maps 403 to IntakeError 403', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(importSource('/restricted/source.png', controller.signal)).rejects.toSatisfy((err: unknown) => {
      return err instanceof IntakeError && err.status === 403;
    });
  });

  it('lets AbortError propagate unchanged', async () => {
    const abortErr = new DOMException('The user aborted a request.', 'AbortError');
    const fetchMock = vi.fn().mockRejectedValue(abortErr);
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(importSource('/remote/art.tiff', controller.signal)).rejects.toThrow(abortErr);
  });
});
