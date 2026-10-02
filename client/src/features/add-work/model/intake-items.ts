import type { Work } from '@/entities/work';
import { isAdmitted, stemOf } from '@/shared/lib/intake-name';
import type { IntakeItem, IntakeSource, IntakeStatus } from './types';

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
