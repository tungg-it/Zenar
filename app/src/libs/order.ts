/** Sparse order between two neighbours (mirrors `order_between` in zenar-format). */
export function orderBetween(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return 1;
  if (next === null) return Math.floor(prev!) + 1;
  if (prev === null) return Math.ceil(next) - 1;
  return (prev + next) / 2;
}
