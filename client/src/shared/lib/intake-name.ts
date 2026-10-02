import { ARCHIVE_EXTENSIONS, MASTER_EXTENSIONS } from '@/shared/config/intake';

const ADMITTED_SET = new Set<string>([
  ...MASTER_EXTENSIONS,
  ...ARCHIVE_EXTENSIONS,
].map((ext) => ext.toLowerCase()));

/** Case-insensitive check whether a file name has an admitted master or archive extension. */
export function isAdmitted(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return ADMITTED_SET.has(name.slice(dot + 1).toLowerCase());
}

/** File name without its last extension, matching the server inbox watcher. */
export function stemOf(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}
