/**
 * Hand-overs to a tree row that does not exist yet.
 *
 * Making or renaming a folder rebuilds the tree, so the row that should act next
 * is a new one. The maker sets the path here; the row with that path takes it on
 * mount and clears it (2026-10 design review).
 */
export const treeRename = $state({
  /** Start naming this row: a new folder used to sit as "New Folder", focus on its parent. */
  path: null as string | null,
  /** Take focus: after a rename, focus fell from the replaced row to the search box. */
  focus: null as string | null,
});

/** The first of `base`, `base 2`, `base 3`… that no sibling is already called. */
export function freeName(base: string, taken: Iterable<string>): string {
  const names = new Set([...taken].map((n) => n.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  let n = 2;
  while (names.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}
