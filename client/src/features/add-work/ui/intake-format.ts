import { BYTES_PER_KIB } from '@/shared/config/units';
import type { AttachmentState } from '@/shared/ui/Attachment';
import type { IntakeItem, IntakeSource } from '../model/types';

const KIB = BYTES_PER_KIB;
const MIB = KIB * BYTES_PER_KIB;
const GIB = MIB * BYTES_PER_KIB;

export function formatBytes(bytes: number): string {
  if (bytes >= GIB) {
    return `${(bytes / GIB).toFixed(1)} GB`;
  }
  if (bytes >= MIB) {
    return `${(bytes / MIB).toFixed(1)} MB`;
  }
  return `${(bytes / KIB).toFixed(1)} KB`;
}

export function extensionOf(item: IntakeItem): string {
  const clean = item.label.split(/[?#]/)[0] ?? '';
  const dot = clean.lastIndexOf('.');
  if (dot >= 0) {
    const ext = clean.slice(dot + 1).replace(/[^a-zA-Z0-9]/g, '');
    if (ext) return ext.toUpperCase();
  }
  return item.source.toUpperCase();
}

export function stateTextOf(item: IntakeItem): string {
  switch (item.status) {
    case 'queued':
      return 'Queued';
    case 'sending': {
      const pct = Math.round(item.sent * 100);
      const rateText = item.rate ? `${formatBytes(item.rate)}/s` : '';
      return rateText ? `Sending ${pct}% · ${rateText}` : `Sending ${pct}%`;
    }
    case 'waiting':
      return 'Waiting for the server';
    case 'ingesting': {
      const pct = item.ingest !== undefined ? Math.round(item.ingest) : 0;
      return `Processing ${pct}%`;
    }
    case 'ready':
      return 'Ready';
    case 'failed':
      return item.error ?? 'Failed';
  }
}

export function descriptionOf(item: IntakeItem): string {
  const parts: string[] = [];
  const ext = extensionOf(item);
  if (ext) parts.push(ext);
  if (item.size !== undefined) {
    parts.push(formatBytes(item.size));
  }
  const stateText = stateTextOf(item);
  if (stateText) parts.push(stateText);
  return parts.join(' · ');
}

export function attachmentStateOf(item: IntakeItem): {
  state: AttachmentState;
  progress?: number;
} {
  switch (item.status) {
    case 'queued':
      return { state: 'idle' };
    case 'sending':
      return { state: 'uploading', progress: item.sent };
    case 'waiting':
      return { state: 'processing' };
    case 'ingesting':
      return {
        state: 'processing',
        progress: item.ingest !== undefined ? item.ingest / 100 : undefined,
      };
    case 'ready':
      return { state: 'done' };
    case 'failed':
      return { state: 'error' };
  }
}

export function iconForSource(source: IntakeSource): string {
  switch (source) {
    case 'file':
      return 'upload';
    case 'link':
      return 'link';
    case 'path':
      return 'computer';
  }
}
