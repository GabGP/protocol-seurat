import type { Work } from '@/entities/work';

export type IntakeSource = 'file' | 'link' | 'path';

export type IntakeStatus =
  | 'queued'
  | 'sending'
  | 'waiting'
  | 'ingesting'
  | 'ready'
  | 'failed';

export interface IntakeItem {
  key: string;
  source: IntakeSource;
  label: string;
  size?: number;
  stem: string;
  status: IntakeStatus;
  sent: number;
  rate?: number;
  ingest?: number;
  error?: string;
  file?: File;
  remote?: {
    phase: 'downloading' | 'copying';
    received?: number;
    total?: number;
  };
}

export type IntakeAction =
  | { type: 'add'; items: IntakeItem[] }
  | { type: 'progress'; key: string; sent: number; rate?: number }
  | { type: 'waiting'; key: string }
  | {
      type: 'remote';
      key: string;
      phase: 'downloading' | 'copying';
      sent?: number;
      received?: number;
      total?: number;
      rate?: number;
    }
  | { type: 'accepted'; key: string }
  | { type: 'failed'; key: string; error: string }
  | { type: 'remove'; key: string }
  | { type: 'cancel'; key: string }
  | { type: 'works'; works: Work[] };
