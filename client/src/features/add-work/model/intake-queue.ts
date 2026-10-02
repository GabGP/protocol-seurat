import { isOpenable, WORK_STATE, type Work } from '@/entities/work';
import { isAdmitted, stemOf } from '@/shared/lib/intake-name';
import type { IntakeAction, IntakeItem, IntakeSource, IntakeStatus } from './types';

let keySeq = 0;

export function createIntakeKey(source: IntakeSource, stem: string): string {
  keySeq += 1;
  return `${source}:${stem}:${keySeq}`;
}

function stripQuotes(s: string): string {
  let trimmed = s.trim();
  while (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function extractLinkName(urlText: string): string {
  const withoutQuery = urlText.split(/[?#]/)[0] ?? '';
  const segments = withoutQuery.split('/').filter(Boolean);
  const raw = segments.pop() ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function extractPathName(pathText: string): string {
  const unquoted = stripQuotes(pathText);
  const segments = unquoted.split(/[/\\]/).filter(Boolean);
  return segments.pop() ?? unquoted;
}

export function itemsFromFiles(files: File[], works: Work[]): IntakeItem[] {
  return files.map((file) => {
    const stem = stemOf(file.name);
    const admitted = isAdmitted(file.name);
    const inWorks = works.some((w) => w.id === stem);
    let status: IntakeStatus = 'queued';
    let error: string | undefined;

    if (!admitted) {
      status = 'failed';
      error = 'Not a supported image';
    } else if (inWorks) {
      status = 'failed';
      error = 'Already in the gallery';
    }

    return {
      key: createIntakeKey('file', stem || 'file'),
      source: 'file',
      label: file.name,
      size: file.size,
      stem,
      status,
      sent: 0,
      file,
      error,
    };
  });
}

export function itemFromText(source: 'link' | 'path', text: string, works: Work[]): IntakeItem {
  const name = source === 'link' ? extractLinkName(text) : extractPathName(text);
  const stem = stemOf(name);
  const admitted = isAdmitted(name);
  const inWorks = works.some((w) => w.id === stem);
  const label = source === 'path' ? stripQuotes(text) : text.trim();
  let status: IntakeStatus = 'queued';
  let error: string | undefined;

  if (!admitted) {
    status = 'failed';
    error = 'Not a supported image';
  } else if (inWorks) {
    status = 'failed';
    error = 'Already in the gallery';
  }

  return {
    key: createIntakeKey(source, stem || 'item'),
    source,
    label,
    stem,
    status,
    sent: 0,
    error,
  };
}

export function intakeReducer(items: IntakeItem[], action: IntakeAction): IntakeItem[] {
  switch (action.type) {
    case 'add': {
      const existing = new Set(items.map((it) => it.key));
      const fresh = action.items.filter((it) => !existing.has(it.key));
      return [...items, ...fresh];
    }
    case 'progress':
      return items.map((it) => {
        if (it.key !== action.key || it.status === 'failed' || it.status === 'ready') return it;
        return { ...it, status: 'sending', sent: action.sent, rate: action.rate };
      });
    case 'waiting':
      return items.map((it) => {
        if (it.key !== action.key || it.status === 'failed' || it.status === 'ready') return it;
        return { ...it, status: 'waiting' };
      });
    case 'accepted':
      return items.map((it) => {
        if (it.key !== action.key || it.status === 'failed' || it.status === 'ready') return it;
        return { ...it, status: 'ingesting', sent: 1, rate: undefined };
      });
    case 'failed':
      return items.map((it) => (it.key === action.key ? { ...it, status: 'failed', error: action.error, rate: undefined } : it));
    case 'cancel':
      return items.map((it) => (it.key === action.key ? { ...it, status: 'failed', error: 'Cancelled', rate: undefined } : it));
    case 'remove':
      return items.filter((it) => it.key !== action.key);
    case 'works': {
      const map = new Map<string, Work>();
      for (const w of action.works) map.set(w.id, w);
      return items.map((it) => {
        const isWaiting = it.status === 'waiting';
        const isSendingDone = it.status === 'sending' && it.sent >= 1;
        const isIngesting = it.status === 'ingesting';
        if (!isWaiting && !isSendingDone && !isIngesting) return it;

        const work = map.get(it.stem);
        if (!work) return it;

        if (work.state === WORK_STATE.FAILED) {
          return { ...it, status: 'failed', error: 'Server could not read this image', rate: undefined };
        }
        if (work.state === WORK_STATE.READY && isOpenable(work)) {
          return { ...it, status: 'ready', ingest: work.progress, rate: undefined };
        }
        return { ...it, status: 'ingesting', ingest: work.progress };
      });
    }
    default:
      return items;
  }
}
