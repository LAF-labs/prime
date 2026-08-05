/**
 * Model ordering & favorites.
 *
 * Sorts models by favorite status and custom order.
 * Persists favorites in localStorage for cross-session persistence.
 */
import type { ModelOption } from '@/stores/settingsStore'

const FAVORITES_KEY = 'kirodex-favorite-models'

// ── Favorites persistence ────────────────────────────────────────

/**
 * Get the set of favorited model IDs from localStorage.
 */
export function getFavoriteModelIds(): Set<string> {
  try {
    const stored = localStorage.getItem(FAVORITES_KEY)
    if (!stored) return new Set()
    const parsed = JSON.parse(stored)
    if (Array.isArray(parsed)) return new Set(parsed)
  } catch { /* best-effort */ }
  return new Set()
}

/**
 * Toggle a model's favorite status.
 */
export function toggleFavoriteModel(modelId: string): Set<string> {
  const favorites = getFavoriteModelIds()
  if (favorites.has(modelId)) {
    favorites.delete(modelId)
  } else {
    favorites.add(modelId)
  }
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]))
  } catch { /* best-effort */ }
  return favorites
}

/**
 * Check if a model is favorited.
 */
export function isModelFavorited(modelId: string): boolean {
  return getFavoriteModelIds().has(modelId)
}

// ── Sorting ──────────────────────────────────────────────────────

export interface SortedModelGroup {
  favorites: ModelOption[]
  others: ModelOption[]
}

/**
 * Sort models into favorites and others groups.
 * Within each group, models maintain their original order.
 */
export function groupModelsByFavorite(models: ModelOption[]): SortedModelGroup {
  const favoriteIds = getFavoriteModelIds()
  const favorites: ModelOption[] = []
  const others: ModelOption[] = []

  for (const model of models) {
    if (favoriteIds.has(model.modelId)) {
      favorites.push(model)
    } else {
      others.push(model)
    }
  }

  return { favorites, others }
}

/**
 * Sort models with favorites first, then others.
 * Preserves relative order within each group.
 */
export function sortModelsWithFavorites(models: ModelOption[]): ModelOption[] {
  const { favorites, others } = groupModelsByFavorite(models)
  return [...favorites, ...others]
}

/**
 * Sort models by a custom order array (model IDs).
 * Models not in the order array are appended at the end.
 */
export function sortModelsByCustomOrder(models: ModelOption[], order: string[]): ModelOption[] {
  const orderMap = new Map(order.map((id, idx) => [id, idx]))
  return [...models].sort((a, b) => {
    const aIdx = orderMap.get(a.modelId) ?? Infinity
    const bIdx = orderMap.get(b.modelId) ?? Infinity
    return aIdx - bIdx
  })
}
