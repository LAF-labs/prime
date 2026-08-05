// Legacy file - no longer used. The file tree now uses lazy directory scanning
// via the project_watcher Rust backend instead of building a tree from a flat list.
// Kept to avoid breaking any stale imports.

export interface TreeNode {
  name: string
  path: string
  isDir: boolean
  children: TreeNode[]
  file?: any
}

export function buildTree(): TreeNode[] {
  return []
}
