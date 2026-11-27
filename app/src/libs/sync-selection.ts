import type { RequestItem } from "../bindings/RequestItem";

/**
 * The Request in front after a background sync replaced the Collection (`prev` → `next`): an
 * untouched one follows the teammate's version, an edited one (Draft) stays as it is. A new tab
 * not saved yet is in neither list and stays too.
 */
export function syncedSelection(
  prev: RequestItem[],
  next: RequestItem[],
  cur: RequestItem | null,
): RequestItem | null {
  if (!cur) return cur;
  const theirs = next.find((x) => x.id === cur.id);
  const old = prev.find((x) => x.id === cur.id);
  if (!old) return theirs ?? cur;
  return JSON.stringify(old) === JSON.stringify(cur) ? (theirs ?? null) : cur;
}
