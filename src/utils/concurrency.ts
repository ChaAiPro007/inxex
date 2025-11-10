/**
 * 并发控制工具
 */

/**
 * 延迟函数
 */
export const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 并发池执行
 * @param items 待处理项目
 * @param concurrency 并发数
 * @param handler 处理函数
 * @param intervalMs 每个请求间隔
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<R>,
  intervalMs = 0
): Promise<R[]> {
  const results: R[] = []
  const executing: Promise<void>[] = []

  for (const item of items) {
    const promise = (async () => {
      const result = await handler(item)
      results.push(result)

      // 请求间隔控制
      if (intervalMs > 0) {
        await delay(intervalMs)
      }
    })()

    executing.push(promise)

    // 并发控制
    if (executing.length >= concurrency) {
      await Promise.race(executing)
      executing.splice(
        executing.findIndex((p) => p === promise),
        1
      )
    }
  }

  // 等待所有任务完成
  await Promise.all(executing)

  return results
}

/**
 * 指数退避重试
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      // 最后一次尝试失败
      if (attempt === maxRetries) {
        break
      }

      // 指数退避：1s, 2s, 4s
      const delayMs = baseDelayMs * Math.pow(2, attempt)
      await delay(delayMs)
    }
  }

  throw lastError
}
