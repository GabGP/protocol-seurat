import { WORK_NAME_MAX } from '@/shared/config/protocol';

export interface EditActions {
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export function cleanName(raw: string): string {
  return raw.trim();
}

export function canRename(raw: string, current: string): boolean {
  const cleaned = cleanName(raw);
  return cleaned.length > 0 && cleaned.length <= WORK_NAME_MAX && cleaned !== current;
}
