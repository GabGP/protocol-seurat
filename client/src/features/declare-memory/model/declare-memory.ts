import { BRUSHES_PER_MEM_MIB, MEM_OVERRIDE_OPTIONS_MIB, SERVER_BRUSH_CAP } from '@/shared/config/session';
import { clearResume, loadMemOverride, saveMemOverride, specMemMib } from '@/entities/session';

export interface MemoryChoice {
  /** null = the spec formula from the device memory. */
  mib: number | null;
  label: string;
}

/** Brushes the server grants a viewer that declares `mib` (spec 6.1). */
export function brushesFor(mib: number): number {
  return Math.min(BRUSHES_PER_MEM_MIB * mib, SERVER_BRUSH_CAP);
}

export function memoryChoices(): MemoryChoice[] {
  return [
    { mib: null, label: `Spec default (${specMemMib()} MiB)` },
    ...MEM_OVERRIDE_OPTIONS_MIB.map((mib) => ({ mib, label: `${mib} MiB` })),
  ];
}

export function currentChoice(): number | null {
  return loadMemOverride();
}

/** A new mem_mib is a new SALUDO: remember it, drop the resume ticket and start over (like a role change). */
export function applyMemory(mib: number | null, restart: () => void = reload): void {
  saveMemOverride(mib);
  clearResume();
  restart();
}

function reload(): void {
  window.location.reload();
}
