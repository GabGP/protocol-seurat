/** ABRIR requests waiting for their ABIERTA (or ERROR): answers come back in order. */
export class OpenQueue {
  private items: Array<{ id: string; preview: boolean }> = [];

  push(id: string, preview: boolean): void {
    this.items.push({ id, preview });
  }

  shift(): { id: string; preview: boolean } | undefined {
    return this.items.shift();
  }

  get length(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}
