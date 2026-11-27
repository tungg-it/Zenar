import type { KeyValue } from "@/bindings/KeyValue";

/** A row's description, kept under `description` in its unknown fields (`extra`), like Postman's. */
export const kvDescription = (r: { extra?: Record<string, unknown> | null }) => (typeof r.extra?.description === "string" ? r.extra.description : "");

/** Patch that sets a row's description; an empty one is removed rather than written as "". */
export function withDescription(r: { extra?: Record<string, unknown> | null }, description: string): { extra: Record<string, unknown> | null } {
  const { description: _, ...rest } = r.extra ?? {};
  const extra = description ? { ...rest, description } : rest;
  return { extra: Object.keys(extra).length ? extra : null };
}

/** Postman's Bulk Edit text: one `key:value` line per row, `//` in front of a disabled row. */
export const toBulk = (rows: KeyValue[]) => rows.map((r) => `${r.enabled ? "" : "//"}${r.key}:${r.value}`).join("\n");

/**
 * Rows from Bulk Edit text. Lines take the rows' ids (and descriptions) in order; extra lines add rows.
 * With `fixedKeys` the rows stay as they are and only take the value of the line with their key.
 */
export function fromBulk(text: string, rows: KeyValue[], fixedKeys: boolean): KeyValue[] {
  const lines = text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const off = l.startsWith("//");
      const body = off ? l.slice(2) : l;
      const at = body.indexOf(":");
      return { enabled: !off, key: at < 0 ? body : body.slice(0, at), value: at < 0 ? "" : body.slice(at + 1) };
    });
  if (fixedKeys) return rows.map((r) => ({ ...r, value: lines.find((l) => l.key === r.key)?.value ?? r.value }));
  return lines.map((l, i) => ({ ...(rows[i] ?? { id: crypto.randomUUID() }), ...l }));
}

/** The rows with the one at `from` moved to `to` (a row dragged in a `KvTable`). */
export function moveItem<T>(rows: readonly T[], from: number, to: number): T[] {
  const next = [...rows];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
