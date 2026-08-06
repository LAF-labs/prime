/**
 * A promise that is guaranteed to settle.
 *
 * IPC calls normally resolve or reject, but "normally" is doing real work
 * there: a backend that never answers leaves the caller's promise pending
 * forever, and any UI gated on it simply never appears. Onboarding hit exactly
 * that — a detection call that never settled left the third step with no
 * buttons and no way forward.
 */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

export const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
