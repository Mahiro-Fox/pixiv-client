export async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  const results = new Array<R>(items.length)
  const size = Math.max(1, Math.min(limit, items.length))
  let cursor = 0

  const run = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      if (signal?.aborted) return
      // index 由 cursor 递增而来，必然落在 items 范围内
      results[index] = await worker(items[index] as T, index)
    }
  }

  await Promise.all(Array.from({ length: size }, () => run()))
  return results
}
