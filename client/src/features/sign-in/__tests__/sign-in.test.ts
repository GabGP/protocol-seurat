import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAccessKey } from '@/entities/session/access-key';
import { detailLabel } from '../lib/detail-label';
import { signIn, signOut, signedIn } from '../model/sign-in';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, v); },
  };
}

const SESSION = { token: 'ab'.repeat(32), lienzo: 'ws://h/x', respaldo: 'ws://h/x', versiones: [1], lado: 256 };

describe('sign-in (spec 3.1: POST /sesion with a Bearer key)', () => {
  let calls: Array<{ auth: string | undefined }>;
  let status: number;

  beforeEach(() => {
    calls = [];
    status = 201;
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      calls.push({ auth: (init.headers as Record<string, string>).Authorization });
      return new Response(JSON.stringify(SESSION), { status });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('checks the key as a Bearer, remembers it, and restarts the session', async () => {
    const restart = vi.fn();
    expect(await signIn(' prof-key ', restart)).toBe('ok');
    expect(calls[0]?.auth).toBe('Bearer prof-key');
    expect(loadAccessKey()).toBe('prof-key');
    expect(signedIn()).toBe(true);
    expect(restart).toHaveBeenCalledOnce();
  });

  it('keeps an unknown key out and says so', async () => {
    status = 401;
    const restart = vi.fn();
    expect(await signIn('nope', restart)).toBe('refused');
    expect(signedIn()).toBe(false);
    expect(restart).not.toHaveBeenCalled();
  });

  it('tells an unreachable server apart from a refused key', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('network'); });
    expect(await signIn('k', vi.fn())).toBe('offline');
  });

  it('signing out forgets the key and drops the resume ticket bound to the account', () => {
    localStorage.setItem('seurat.accessKey', 'k');
    sessionStorage.setItem('seurat.session', '7');
    const restart = vi.fn();
    signOut(restart);
    expect(signedIn()).toBe(false);
    expect(sessionStorage.getItem('seurat.session')).toBeNull();
    expect(restart).toHaveBeenCalledOnce();
  });
});

describe('detailLabel (ABIERTA ceiling, spec 2.3)', () => {
  it('names each default role ceiling', () => {
    expect(detailLabel(0, 4)).toMatch(/^Full quality/);
    expect(detailLabel(0, 2)).toBe('Native resolution, 2 of 4 detail bands');
    expect(detailLabel(1, 2)).toBe('1/2 resolution, 2 of 4 detail bands');
  });
});
