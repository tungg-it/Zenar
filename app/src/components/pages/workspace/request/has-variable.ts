import { createContext, useContext } from "react";
import type { PreviewVar } from "@/bindings/PreviewVar";

/**
 * Whether `{{name}}` has a value where the Request runs. `RequestEditor` provides it; without a
 * provider (Collection / Folder defaults) every variable counts as known.
 */
export const HasVariable = createContext<(name: string) => boolean>(() => true);

export const useHasVariable = () => useContext(HasVariable);

/** A variable offered after typing `{{`; a Secret's value is never shown. */
export type VarOption = PreviewVar & { secret: boolean };

/** Every variable available where the Request runs. Empty without a provider: nothing is suggested. */
export const VariableOptions = createContext<VarOption[]>([]);

/** Token chip classes, shared by every field that colours `{{variables}}`. The ring draws the padding. */
export const VAR_KNOWN = "rounded-sm bg-z-link/15 text-z-link ring-2 ring-z-link/15";
export const VAR_UNKNOWN = "rounded-sm bg-z-delete/15 text-z-delete ring-2 ring-z-delete/15";

export type VarToken = { text: string; known?: boolean };

/** Split `text` into plain runs and `{{name}}` runs, the latter marked known or not. */
export function variableTokens(text: string, has: (name: string) => boolean): VarToken[] {
  const out: VarToken[] = [];
  let i = 0;
  for (const m of text.matchAll(/\{\{([^{}]*)\}\}/g)) {
    if (m.index > i) out.push({ text: text.slice(i, m.index) });
    out.push({ text: m[0], known: has(m[1].trim()) });
    i = m.index + m[0].length;
  }
  if (i < text.length) out.push({ text: text.slice(i) });
  return out;
}
