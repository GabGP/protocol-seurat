import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MASTER_EXTENSIONS } from '@/shared/config/intake';
import { isAdmitted, stemOf } from '../intake-name';

describe('isAdmitted', () => {
  it('accepts upper-case extensions', () => {
    expect(isAdmitted('photo.PNG')).toBe(true);
    expect(isAdmitted('photo.JPG')).toBe(true);
    expect(isAdmitted('photo.JPEG')).toBe(true);
    expect(isAdmitted('scan.TIF')).toBe(true);
    expect(isAdmitted('scan.TIFF')).toBe(true);
    expect(isAdmitted('layer.PSB')).toBe(true);
    expect(isAdmitted('layer.PSD')).toBe(true);
    expect(isAdmitted('archive.ZIP')).toBe(true);
  });

  it('rejects .txt and unadmitted files', () => {
    expect(isAdmitted('notes.txt')).toBe(false);
    expect(isAdmitted('data.json')).toBe(false);
    expect(isAdmitted('binary.bin')).toBe(false);
    expect(isAdmitted('no_extension')).toBe(false);
    expect(isAdmitted('')).toBe(false);
  });

  it('accepts all lowercase master and archive extensions', () => {
    for (const ext of MASTER_EXTENSIONS) {
      expect(isAdmitted(`sample.${ext}`)).toBe(true);
    }
    expect(isAdmitted('sample.zip')).toBe(true);
  });
});

describe('stemOf', () => {
  it('strips the last extension so stem of a.b.png is a.b', () => {
    expect(stemOf('a.b.png')).toBe('a.b');
  });

  it('strips extension for various file names', () => {
    expect(stemOf('photo.jpg')).toBe('photo');
    expect(stemOf('bundle.tar.gz')).toBe('bundle.tar');
    expect(stemOf('archive.zip')).toBe('archive');
    expect(stemOf('no_ext')).toBe('no_ext');
  });
});

describe('MasterNames sync', () => {
  it('matches EXTENSIONS in server MasterNames.java', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const javaPath = resolve(here, '../../../../../server/src/seurat/core/works/catalog/MasterNames.java');
    const content = readFileSync(javaPath, 'utf8');
    const match = /EXTENSIONS\s*=\s*List\.of\(([^)]+)\)/.exec(content);
    expect(match).not.toBeNull();
    const group = match?.[1] ?? '';
    const extracted = [...group.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '');
    expect(extracted).toEqual([...MASTER_EXTENSIONS]);
  });
});
