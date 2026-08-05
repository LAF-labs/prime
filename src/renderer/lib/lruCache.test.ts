import { describe, expect, it } from 'vitest'
import { LRUCache } from './lruCache'

describe('LRUCache', () => {
  it('returns null for missing keys', () => {
    const cache = new LRUCache<string>(2, 100)
    expect(cache.get('missing')).toBeNull()
  })

  it('evicts oldest by max entries', () => {
    const cache = new LRUCache<string>(2, 1_000)
    cache.set('a', 'A', 10)
    cache.set('b', 'B', 10)
    cache.set('c', 'C', 10)

    expect(cache.get('a')).toBeNull()
    expect(cache.get('b')).toBe('B')
    expect(cache.get('c')).toBe('C')
  })

  it('promotes on get and evicts least recently used', () => {
    const cache = new LRUCache<string>(2, 1_000)
    cache.set('a', 'A', 10)
    cache.set('b', 'B', 10)
    expect(cache.get('a')).toBe('A')

    cache.set('c', 'C', 10)
    expect(cache.get('a')).toBe('A')
    expect(cache.get('b')).toBeNull()
    expect(cache.get('c')).toBe('C')
  })

  it('evicts by memory budget', () => {
    const cache = new LRUCache<string>(10, 25)
    cache.set('a', 'A', 10)
    cache.set('b', 'B', 10)
    cache.set('c', 'C', 10)

    expect(cache.get('a')).toBeNull()
    expect(cache.get('b')).toBe('B')
    expect(cache.get('c')).toBe('C')
  })

  it('updates totalSize on overwrite', () => {
    const cache = new LRUCache<string>(10, 100)
    cache.set('a', 'A', 40)
    cache.set('a', 'A2', 80)
    // Overwrite must replace, not double-count
    cache.set('b', 'B', 15)
    expect(cache.get('a')).toBe('A2')
    expect(cache.get('b')).toBe('B')
  })

  it('clear empties the cache', () => {
    const cache = new LRUCache<string>(10, 100)
    cache.set('a', 'A', 10)
    cache.clear()
    expect(cache.get('a')).toBeNull()
    expect(cache.size).toBe(0)
  })

  it('rejects inserts that exceed the memory budget on their own', () => {
    const cache = new LRUCache<string>(10, 100)
    cache.set('a', 'A', 10)
    cache.set('huge', 'X', 200)
    // Oversized entry must be silently dropped — otherwise the eviction
    // loop would clear the cache and leave us still over budget.
    expect(cache.get('huge')).toBeNull()
    // The pre-existing entry must survive untouched.
    expect(cache.get('a')).toBe('A')
  })
})
describe('LRUCache.prune', () => {
  it('drops entries matching the predicate and recovers their size', () => {
    const cache = new LRUCache<string>(10, 100)
    cache.set('keep:a', 'A', 30)
    cache.set('drop:b', 'B', 30)
    cache.set('drop:c', 'C', 30)
    cache.prune((key) => key.startsWith('drop:'))
    expect(cache.get('keep:a')).toBe('A')
    expect(cache.get('drop:b')).toBeNull()
    expect(cache.get('drop:c')).toBeNull()
    expect(cache.size).toBe(1)
    // Reclaimed budget should let a large new entry land that wouldn't
    // have fit before pruning.
    cache.set('big', 'X', 60)
    expect(cache.get('big')).toBe('X')
    expect(cache.get('keep:a')).toBe('A')
  })

  it('is a no-op when no keys match', () => {
    const cache = new LRUCache<string>(10, 100)
    cache.set('a', 'A', 10)
    cache.prune(() => false)
    expect(cache.get('a')).toBe('A')
    expect(cache.size).toBe(1)
  })
})
