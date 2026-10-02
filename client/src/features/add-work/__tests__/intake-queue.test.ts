import { describe, expect, it } from 'vitest';
import { WORK_STATE, type Work } from '@/entities/work';
import {
  intakeReducer,
  itemFromText,
  itemsFromFiles,
  type IntakeItem,
} from '../index';
import { attachmentStateOf, stateTextOf } from '../ui/intake-format';

function makeWork(id: string, state: number, progress = 0, edition = 1): Work {
  return {
    id,
    name: id,
    width: 2000,
    height: 1500,
    strata: 4,
    state: state as Work['state'],
    edition,
    progress,
  };
}

describe('itemsFromFiles', () => {
  it('adds supported files as queued', () => {
    const file = new File(['fake-content'], 'masterpiece.png', { type: 'image/png' });
    const items = itemsFromFiles([file], []);
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe('queued');
    expect(items[0]?.stem).toBe('masterpiece');
    expect(items[0]?.label).toBe('masterpiece.png');
    expect(items[0]?.file).toBe(file);
    expect(items[0]?.sent).toBe(0);
  });

  it('fails duplicate files already in the gallery at add time', () => {
    const works = [makeWork('existing', WORK_STATE.READY)];
    const file = new File(['data'], 'existing.jpg', { type: 'image/jpeg' });
    const items = itemsFromFiles([file], works);
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe('failed');
    expect(items[0]?.error).toBe('Already in the gallery');
  });

  it('fails unsupported files at add time', () => {
    const file = new File(['data'], 'document.pdf', { type: 'application/pdf' });
    const items = itemsFromFiles([file], []);
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe('failed');
    expect(items[0]?.error).toBe('Not a supported image');
  });
});

describe('itemFromText', () => {
  it('extracts decoded stem and handles query params from link', () => {
    const url = ['htt', 'ps://example.com/gallery/art%20piece.png?size=large#preview'].join('');
    const item = itemFromText('link', url, []);
    expect(item.stem).toBe('art piece');
    expect(item.status).toBe('queued');
    expect(item.label).toBe(url);
  });

  it('strips surrounding quotes and handles backslash paths', () => {
    const rawPath = '"C:\\Users\\Artist\\Pictures\\starry_night.tiff"';
    const item = itemFromText('path', rawPath, []);
    expect(item.stem).toBe('starry_night');
    expect(item.label).toBe('C:\\Users\\Artist\\Pictures\\starry_night.tiff');
    expect(item.status).toBe('queued');
  });

  it('handles Unix style paths', () => {
    const item = itemFromText('path', '/var/data/masters/landscape.psb', []);
    expect(item.stem).toBe('landscape');
    expect(item.status).toBe('queued');
  });

  it('fails unsupported extension in text', () => {
    const item = itemFromText('path', 'notes.txt', []);
    expect(item.status).toBe('failed');
    expect(item.error).toBe('Not a supported image');
  });

  it('fails duplicate stem in text when already in gallery', () => {
    const works = [makeWork('mona-lisa', WORK_STATE.READY)];
    const item = itemFromText('path', '"/photos/mona-lisa.png"', works);
    expect(item.status).toBe('failed');
    expect(item.error).toBe('Already in the gallery');
  });
});

describe('intakeReducer', () => {
  const sampleItem: IntakeItem = {
    key: 'k-1',
    source: 'file',
    label: 'sample.png',
    stem: 'sample',
    status: 'queued',
    sent: 0,
  };

  it('adds items and ignores duplicate keys', () => {
    const next = intakeReducer([], { type: 'add', items: [sampleItem] });
    expect(next).toEqual([sampleItem]);
    const duplicate = intakeReducer(next, { type: 'add', items: [sampleItem] });
    expect(duplicate).toHaveLength(1);
  });

  it('transitions queued to sending on progress', () => {
    const next = intakeReducer([sampleItem], { type: 'progress', key: 'k-1', sent: 0.5, rate: 50_000 });
    expect(next[0]?.status).toBe('sending');
    expect(next[0]?.sent).toBe(0.5);
    expect(next[0]?.rate).toBe(50_000);
  });

  it('sets waiting status', () => {
    const next = intakeReducer([sampleItem], { type: 'waiting', key: 'k-1' });
    expect(next[0]?.status).toBe('waiting');
  });

  it('sets ingesting status on accepted', () => {
    const sending: IntakeItem = { ...sampleItem, status: 'sending', sent: 0.9, rate: 10_000 };
    const next = intakeReducer([sending], { type: 'accepted', key: 'k-1' });
    expect(next[0]?.status).toBe('ingesting');
    expect(next[0]?.sent).toBe(1);
    expect(next[0]?.rate).toBeUndefined();
  });

  it('handles failed and cancel actions', () => {
    const failed = intakeReducer([sampleItem], { type: 'failed', key: 'k-1', error: 'Disk full' });
    expect(failed[0]?.status).toBe('failed');
    expect(failed[0]?.error).toBe('Disk full');

    const cancelled = intakeReducer([sampleItem], { type: 'cancel', key: 'k-1' });
    expect(cancelled[0]?.status).toBe('failed');
    expect(cancelled[0]?.error).toBe('Cancelled');
  });

  it('removes an item by key', () => {
    const next = intakeReducer([sampleItem], { type: 'remove', key: 'k-1' });
    expect(next).toHaveLength(0);
  });

  describe('remote action and formatting', () => {
    const waitingItem: IntakeItem = { ...sampleItem, status: 'waiting' };

    it('updates waiting item on remote downloading with known total (Server downloading 42%)', () => {
      const next = intakeReducer([waitingItem], {
        type: 'remote',
        key: 'k-1',
        phase: 'downloading',
        sent: 0.42,
        received: 4200,
        total: 10000,
      });
      const item = next[0]!;
      expect(item.status).toBe('waiting');
      expect(item.sent).toBe(0.42);
      expect(item.remote).toEqual({ phase: 'downloading', received: 4200, total: 10000 });
      expect(stateTextOf(item)).toBe('Server downloading 42%');
      expect(attachmentStateOf(item)).toEqual({ state: 'uploading', progress: 0.42 });
    });

    it('updates waiting item on remote downloading with unknown total', () => {
      const next = intakeReducer([waitingItem], {
        type: 'remote',
        key: 'k-1',
        phase: 'downloading',
        received: 51200,
      });
      const item = next[0]!;
      expect(item.status).toBe('waiting');
      expect(item.remote).toEqual({ phase: 'downloading', received: 51200, total: undefined });
      expect(stateTextOf(item)).toBe('Server downloading 50.0 KB');
      expect(attachmentStateOf(item)).toEqual({ state: 'processing' });
    });

    it('updates waiting item on remote copying (Server copying)', () => {
      const next = intakeReducer([waitingItem], {
        type: 'remote',
        key: 'k-1',
        phase: 'copying',
      });
      const item = next[0]!;
      expect(item.status).toBe('waiting');
      expect(item.remote).toEqual({ phase: 'copying', received: undefined, total: undefined });
      expect(stateTextOf(item)).toBe('Server copying');
      expect(attachmentStateOf(item)).toEqual({ state: 'processing' });
    });

    it('formats plain waiting item without remote', () => {
      expect(stateTextOf(waitingItem)).toBe('Waiting for the server');
      expect(attachmentStateOf(waitingItem)).toEqual({ state: 'processing' });
    });

    it('ignores remote action when item status is not waiting', () => {
      const queuedItem: IntakeItem = { ...sampleItem, status: 'queued' };
      const next = intakeReducer([queuedItem], {
        type: 'remote',
        key: 'k-1',
        phase: 'downloading',
        sent: 0.5,
        received: 500,
        total: 1000,
      });
      expect(next[0]).toBe(queuedItem);
    });
  });

  describe('works action transitions', () => {
    it('transitions processing work to ingesting with progress then to ready', () => {
      const item: IntakeItem = { ...sampleItem, status: 'waiting' };
      const processingWork = makeWork('sample', WORK_STATE.SKETCH, 45, 0);

      const step1 = intakeReducer([item], { type: 'works', works: [processingWork] });
      expect(step1[0]?.status).toBe('ingesting');
      expect(step1[0]?.ingest).toBe(45);

      const readyWork = makeWork('sample', WORK_STATE.READY, 100, 1);
      const step2 = intakeReducer(step1, { type: 'works', works: [readyWork] });
      expect(step2[0]?.status).toBe('ready');
      expect(step2[0]?.ingest).toBe(100);
    });

    it('transitions FAILED work state to failed with descriptive reason', () => {
      const item: IntakeItem = { ...sampleItem, status: 'ingesting' };
      const failedWork = makeWork('sample', WORK_STATE.FAILED);

      const next = intakeReducer([item], { type: 'works', works: [failedWork] });
      expect(next[0]?.status).toBe('failed');
      expect(next[0]?.error).toBe('Server could not read this image');
    });

    it('processes sending items that have completed upload (sent >= 1)', () => {
      const item: IntakeItem = { ...sampleItem, status: 'sending', sent: 1 };
      const work = makeWork('sample', WORK_STATE.PAINTING, 60);

      const next = intakeReducer([item], { type: 'works', works: [work] });
      expect(next[0]?.status).toBe('ingesting');
      expect(next[0]?.ingest).toBe(60);
    });

    it('ignores items that are queued or still uploading (sent < 1)', () => {
      const queuedItem: IntakeItem = { ...sampleItem, status: 'queued', sent: 0 };
      const uploadingItem: IntakeItem = { ...sampleItem, key: 'k-2', stem: 'sample', status: 'sending', sent: 0.5 };
      const work = makeWork('sample', WORK_STATE.READY, 100);

      const next = intakeReducer([queuedItem, uploadingItem], { type: 'works', works: [work] });
      expect(next[0]?.status).toBe('queued');
      expect(next[1]?.status).toBe('sending');
    });
  });
});
