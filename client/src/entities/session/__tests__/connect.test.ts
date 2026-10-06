import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectTransport } from '../client/connect';

interface FakeWtInstance {
  name: string;
  closed: boolean;
  url: string;
  certHash: string | undefined;
}

interface FakeWsInstance {
  name: string;
  closed: boolean;
  url: string;
}

const mocks = vi.hoisted(() => ({
  wtInstances: [] as FakeWtInstance[],
  wsInstances: [] as FakeWsInstance[],
  wtSupported: true,
  wtShouldFail: false,
}));

vi.mock('@/shared/api/wt', () => ({
  WtTransport: class {
    readonly name = 'webtransport';
    closed = false;
    url: string;
    certHash: string | undefined;

    constructor(url: string, certHash?: string) {
      this.url = url;
      this.certHash = certHash;
      mocks.wtInstances.push(this);
    }

    static supported(): boolean {
      return mocks.wtSupported;
    }

    async connect(): Promise<void> {
      if (mocks.wtShouldFail) throw new Error('connect fail');
    }

    close(): void {
      this.closed = true;
    }
  },
}));

vi.mock('@/shared/api/ws', () => ({
  WsTransport: class {
    readonly name = 'websocket';
    closed = false;
    url: string;

    constructor(url: string) {
      this.url = url;
      mocks.wsInstances.push(this);
    }

    async connect(): Promise<void> {}

    close(): void {
      this.closed = true;
    }
  },
}));

describe('connectTransport', () => {
  beforeEach(() => {
    mocks.wtInstances = [];
    mocks.wsInstances = [];
    mocks.wtSupported = true;
    mocks.wtShouldFail = false;
  });

  it('connects to webtransport when https: and supported, passing certHash', async () => {
    mocks.wtSupported = true;
    mocks.wtShouldFail = false;
    const statuses: string[] = [];
    const wired: unknown[] = [];

    const t = await connectTransport('https:lienzo', 'ws:lienzo', 'deadbeef', (x) => wired.push(x), (s) => statuses.push(s));

    expect(t.name).toBe('webtransport');
    expect(statuses).toEqual(['webtransport']);
    expect(wired).toEqual([t]);
    expect(mocks.wtInstances.length).toBe(1);
    expect(mocks.wtInstances[0]?.certHash).toBe('deadbeef');
    expect(mocks.wsInstances.length).toBe(0);
  });

  it('falls back to websocket and closes failed transport when connect() rejects', async () => {
    mocks.wtSupported = true;
    mocks.wtShouldFail = true;
    const statuses: string[] = [];
    const wired: unknown[] = [];

    const t = await connectTransport('https:lienzo', 'ws:lienzo', 'deadbeef', (x) => wired.push(x), (s) => statuses.push(s));

    expect(t.name).toBe('websocket');
    expect(statuses).toEqual(['websocket']);
    expect(wired).toEqual([t]);
    expect(mocks.wtInstances.length).toBe(1);
    expect(mocks.wtInstances[0]?.closed).toBe(true);
    expect(mocks.wsInstances.length).toBe(1);
  });

  it('falls back to websocket without constructing WtTransport when url is ws:', async () => {
    mocks.wtSupported = true;
    mocks.wtShouldFail = false;
    const statuses: string[] = [];
    const wired: unknown[] = [];

    const t = await connectTransport('ws:lienzo', 'ws:fallback', 'deadbeef', (x) => wired.push(x), (s) => statuses.push(s));

    expect(t.name).toBe('websocket');
    expect(statuses).toEqual(['websocket']);
    expect(wired).toEqual([t]);
    expect(mocks.wtInstances.length).toBe(0);
    expect(mocks.wsInstances.length).toBe(1);
    expect(mocks.wsInstances[0]?.url).toBe('ws:fallback');
  });

  it('falls back to websocket when WebTransport is not supported', async () => {
    mocks.wtSupported = false;
    mocks.wtShouldFail = false;
    const statuses: string[] = [];
    const wired: unknown[] = [];

    const t = await connectTransport('https:lienzo', 'ws:fallback', 'deadbeef', (x) => wired.push(x), (s) => statuses.push(s));

    expect(t.name).toBe('websocket');
    expect(statuses).toEqual(['websocket']);
    expect(wired).toEqual([t]);
    expect(mocks.wtInstances.length).toBe(0);
    expect(mocks.wsInstances.length).toBe(1);
    expect(mocks.wsInstances[0]?.url).toBe('ws:fallback');
  });
});
