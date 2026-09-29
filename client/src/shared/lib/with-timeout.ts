/** `p`, or a rejection with `message` if it has not settled within `ms`. */
export async function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer = 0;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = globalThis.setTimeout(() => reject(new Error(message)), ms) as unknown as number;
      }),
    ]);
  } finally {
    globalThis.clearTimeout(timer);
  }
}
