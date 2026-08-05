/**
 * Bounded LRU cache with both an entry count cap and an approximate-memory cap.
 *
 * The cache evicts the least-recently-used entry when either limit would be
 * exceeded by an insert. Promotion happens on `get` so the most-recently-read
 * entry stays alive longest.
 *
 * `approximateSize` is whatever the caller wants to use as a memory-cost
 * estimate (bytes is the obvious choice for cached strings/HTML).
 *
 * Ported so chat-markdown highlighting can cache rendered HTML
 * across re-renders without growing unbounded.
 */
interface CacheEntry<T> {
  value: T
  approximateSize: number
}

export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private totalSize = 0

  constructor(
    private readonly maxEntries: number,
    private readonly maxMemoryBytes: number,
  ) {}

  get(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    // Map preserves insertion order, so re-inserting moves to the end (MRU).
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry.value
  }

  set(key: string, value: T, approximateSize: number): void {
    const existing = this.cache.get(key)
    if (existing) {
      this.totalSize -= existing.approximateSize
      this.cache.delete(key)
    }
    // Reject inserts that on their own exceed the memory budget — otherwise
    // `evictIfNeeded` would empty the cache (still leaving us over budget)
    // and then every subsequent `set` would do the same. Better to silently
    // drop the value; callers (highlighter cache) will just re-render on
    // demand.
    if (approximateSize > this.maxMemoryBytes) {
      return
    }
    this.evictIfNeeded(approximateSize)
    this.cache.set(key, { value, approximateSize })
    this.totalSize += approximateSize
  }

  has(key: string): boolean {
    return this.cache.has(key)
  }

  /**
   * Drop every entry whose key matches `predicate`. Used (for example) to
   * evict highlighted-code HTML for the inactive theme when the user
   * toggles dark/light, so we don't pin both sets in memory until LRU
   * eviction catches up.
   */
  prune(predicate: (key: string) => boolean): void {
    for (const key of Array.from(this.cache.keys())) {
      if (!predicate(key)) continue
      const entry = this.cache.get(key)
      if (entry) this.totalSize -= entry.approximateSize
      this.cache.delete(key)
    }
  }

  clear(): void {
    this.cache.clear()
    this.totalSize = 0
  }

  /** Visible mainly for tests. */
  get size(): number {
    return this.cache.size
  }

  private evictIfNeeded(incomingSize: number): void {
    while (
      (this.cache.size >= this.maxEntries ||
        this.totalSize + incomingSize > this.maxMemoryBytes) &&
      this.cache.size > 0
    ) {
      // Pull the oldest entry directly via the iterator so we don't pay
      // for a second `Map.get` call after `keys().next()`.
      const oldest = this.cache.entries().next().value
      if (!oldest) break
      const [oldestKey, oldestEntry] = oldest
      this.totalSize -= oldestEntry.approximateSize
      this.cache.delete(oldestKey)
    }
  }
}
