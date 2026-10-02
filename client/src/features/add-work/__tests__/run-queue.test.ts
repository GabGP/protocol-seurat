import { describe, expect, it, vi } from 'vitest';
import { PROGRESS_THROTTLE_MS } from '@/shared/config/intake-ui';
import { runQueue, type IntakeAction, type IntakeItem, type RunQueueDeps } from '../index';

describe('runQueue', () => {
  function makeItem(id: string, source: 'file' | 'link' | 'path', label: string): IntakeItem {
    return {
      key: `key-${id}`,
      source,
      label,
      stem: id,
      status: 'queued',
      sent: 0,
      file: source === 'file' ? new File(['test'], label, { type: 'image/png' }) : undefined,
    };
  }

  it('runs items strictly one at a time sequentially', async () => {
    const item1 = makeItem('one', 'file', 'one.png');
    const item2 = makeItem('two', 'path', '/path/two.png');
    const events: string[] = [];
    const actions: IntakeAction[] = [];

    const deps: RunQueueDeps = {
      upload: async (_file, _onProgress) => {
        events.push('upload-start');
        await new Promise((r) => setTimeout(r, 10));
        events.push('upload-end');
      },
      importSource: async (_text) => {
        events.push('import-start');
        await new Promise((r) => setTimeout(r, 10));
        events.push('import-end');
      },
      dispatch: (action) => actions.push(action),
      signalFor: () => new AbortController().signal,
      now: () => Date.now(),
    };

    await runQueue([item1, item2], deps);

    expect(events).toEqual(['upload-start', 'upload-end', 'import-start', 'import-end']);
    expect(actions).toEqual([
      { type: 'accepted', key: 'key-one' },
      { type: 'waiting', key: 'key-two' },
      { type: 'accepted', key: 'key-two' },
    ]);
  });

  it('maps a status 415 error to Not a supported image', async () => {
    const item = makeItem('unsupported', 'file', 'unsupported.xyz');
    const actions: IntakeAction[] = [];

    const deps: RunQueueDeps = {
      upload: async () => {
        const error = new Error('Unsupported Media Type');
        (error as { status?: number }).status = 415;
        throw error;
      },
      importSource: async () => {},
      dispatch: (action) => actions.push(action),
      signalFor: () => new AbortController().signal,
      now: () => Date.now(),
    };

    await runQueue([item], deps);

    expect(actions).toEqual([
      { type: 'failed', key: 'key-unsupported', error: 'Not a supported image' },
    ]);
  });

  it('marks an aborted item as failed', async () => {
    const item = makeItem('aborted', 'file', 'aborted.png');
    const actions: IntakeAction[] = [];
    const controller = new AbortController();

    const deps: RunQueueDeps = {
      upload: async (_file, _onProgress, signal) => {
        controller.abort();
        const err = new Error('AbortError');
        err.name = 'AbortError';
        if (signal.aborted) throw err;
      },
      importSource: async () => {},
      dispatch: (action) => actions.push(action),
      signalFor: () => controller.signal,
      now: () => Date.now(),
    };

    await runQueue([item], deps);

    expect(actions).toEqual([
      { type: 'failed', key: 'key-aborted', error: 'Cancelled' },
    ]);
  });

  it('marks an already aborted queued item as failed without executing upload', async () => {
    const item = makeItem('preaborted', 'file', 'preaborted.png');
    const actions: IntakeAction[] = [];
    const controller = new AbortController();
    controller.abort();
    const uploadSpy = vi.fn();

    const deps: RunQueueDeps = {
      upload: uploadSpy,
      importSource: async () => {},
      dispatch: (action) => actions.push(action),
      signalFor: () => controller.signal,
      now: () => Date.now(),
    };

    await runQueue([item], deps);

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(actions).toEqual([
      { type: 'failed', key: 'key-preaborted', error: 'Cancelled' },
    ]);
  });

  it('throttles progress events and calculates byte rate from deps.now', async () => {
    const item = makeItem('upload', 'file', 'large.png');
    const actions: IntakeAction[] = [];
    let currentTime = 1000;

    const deps: RunQueueDeps = {
      upload: async (_file, onProgress) => {
        // Initial progress at t=1000
        onProgress(0, 10_000);

        // Immediate follow-up within throttle window (< PROGRESS_THROTTLE_MS): should be ignored
        currentTime = 1020;
        onProgress(1_000, 10_000);

        // After throttle window: t = 1000 + PROGRESS_THROTTLE_MS + 50 = 1150 ms
        currentTime = 1000 + PROGRESS_THROTTLE_MS + 50;
        onProgress(5_000, 10_000);

        // Complete: should not be skipped even if close to last
        currentTime += 50;
        onProgress(10_000, 10_000);
      },
      importSource: async () => {},
      dispatch: (action) => actions.push(action),
      signalFor: () => new AbortController().signal,
      now: () => currentTime,
    };

    await runQueue([item], deps);

    const progressActions = actions.filter((a) => a.type === 'progress');
    expect(progressActions).toHaveLength(3);
    expect(progressActions[0]).toEqual({
      type: 'progress',
      key: 'key-upload',
      sent: 0,
      rate: undefined,
    });
    // 5000 bytes sent in 150ms -> 5000 / 0.15 = 33333 bytes/s
    expect(progressActions[1]).toEqual({
      type: 'progress',
      key: 'key-upload',
      sent: 0.5,
      rate: 33333,
    });
    // Another 5000 bytes sent in 50ms -> 5000 / 0.05 = 100000 bytes/s
    expect(progressActions[2]).toEqual({
      type: 'progress',
      key: 'key-upload',
      sent: 1,
      rate: 100000,
    });
  });

  it('maps network errors without status code to Connection lost', async () => {
    const item = makeItem('err', 'link', '/remote/pic.png');
    const actions: IntakeAction[] = [];

    const deps: RunQueueDeps = {
      upload: async () => {},
      importSource: async () => {
        throw new Error('Connection refused');
      },
      dispatch: (action) => actions.push(action),
      signalFor: () => new AbortController().signal,
      now: () => Date.now(),
    };

    await runQueue([item], deps);

    expect(actions).toEqual([
      { type: 'waiting', key: 'key-err' },
      { type: 'failed', key: 'key-err', error: 'Connection lost' },
    ]);
  });

  it('passes onProgress to importSource and dispatches remote actions with rate calculation', async () => {
    const item = makeItem('remote-test', 'link', '/remote/huge.png');
    const actions: IntakeAction[] = [];
    let currentTime = 2000;

    const deps: RunQueueDeps = {
      upload: async () => {},
      importSource: async (_text, _signal, onProgress) => {
        onProgress?.({ phase: 'copying' });
        onProgress?.({ phase: 'downloading', received: 0, total: 20_000 });

        currentTime = 2020;
        onProgress?.({ phase: 'downloading', received: 2_000, total: 20_000 });

        currentTime = 2000 + PROGRESS_THROTTLE_MS + 50;
        onProgress?.({ phase: 'downloading', received: 10_000, total: 20_000 });

        currentTime += 50;
        onProgress?.({ phase: 'downloading', received: 20_000, total: 20_000 });
      },
      dispatch: (action) => actions.push(action),
      signalFor: () => new AbortController().signal,
      now: () => currentTime,
    };

    await runQueue([item], deps);

    const remoteActions = actions.filter((a) => a.type === 'remote');
    expect(remoteActions).toHaveLength(4);
    expect(remoteActions[0]).toEqual({
      type: 'remote',
      key: 'key-remote-test',
      phase: 'copying',
    });
    expect(remoteActions[1]).toEqual({
      type: 'remote',
      key: 'key-remote-test',
      phase: 'downloading',
      sent: 0,
      received: 0,
      total: 20_000,
      rate: undefined,
    });
    expect(remoteActions[2]).toEqual({
      type: 'remote',
      key: 'key-remote-test',
      phase: 'downloading',
      sent: 0.5,
      received: 10_000,
      total: 20_000,
      rate: 66667,
    });
    expect(remoteActions[3]).toEqual({
      type: 'remote',
      key: 'key-remote-test',
      phase: 'downloading',
      sent: 1,
      received: 20_000,
      total: 20_000,
      rate: 200000,
    });
  });
});

