/** VRAM the viewer holds in texture arrays (telemetry only): each atlas reports what it allocates and frees. */
let bytes = 0;

export function addGpuBytes(delta: number): void {
  bytes = Math.max(0, bytes + delta);
}

export function gpuBytes(): number {
  return bytes;
}
