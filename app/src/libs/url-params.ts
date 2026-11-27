import type { KeyValue } from "@/bindings/KeyValue";

/**
 * The URL bar shows `url` + the query built from the enabled Params, like Postman.
 * `url` is stored without its query (the backend appends `params` when it sends),
 * so text typed after `?` is split back into Params. Keys and values stay raw:
 * `{{name}}` must survive, and the backend encodes them when it sends.
 */

/** Params that show in the URL bar: enabled, not a blank row. */
const shown = (p: KeyValue) => p.enabled && (p.key !== "" || p.value !== "");

export function urlWithParams(url: string, params: KeyValue[]): string {
  const query = params
    .filter(shown)
    .map((p) => (p.value === "" ? p.key : `${p.key}=${p.value}`))
    .join("&");
  if (!query) return url;
  return url + (url.includes("?") ? "&" : "?") + query;
}

/**
 * Splits URL bar text into the base URL and Params. Shown Params take the typed
 * pairs in order (keeping their ids); disabled and blank rows stay where they are;
 * extra pairs become new rows.
 */
export function splitUrlParams(text: string, params: KeyValue[]): { url: string; params: KeyValue[] } {
  const at = text.indexOf("?");
  if (at < 0) return { url: text, params: params.filter((p) => !shown(p)) };
  const pairs = text
    .slice(at + 1)
    .split("&")
    .map((s) => {
      const eq = s.indexOf("=");
      return eq < 0 ? { key: s, value: "" } : { key: s.slice(0, eq), value: s.slice(eq + 1) };
    })
    .filter((p) => p.key !== "" || p.value !== "");
  let next = 0;
  const kept = params.flatMap((p) => (shown(p) ? (next < pairs.length ? [{ ...p, ...pairs[next++] }] : []) : [p]));
  const added = pairs.slice(next).map((p) => ({ id: crypto.randomUUID(), ...p, enabled: true }));
  return { url: text.slice(0, at), params: [...kept, ...added] };
}

/** A `:name` path segment (same rule as the backend's compose), or `:name=value` as typed. */
const PATH_VAR = /^:([A-Za-z0-9_-]+)(?:=(.*))?$/;

/**
 * Path Variables follow the `:name` segments of the URL path: one row per name, in URL order.
 * A row keeps its value while its name stays, or while it is renamed in place (same position).
 * Typing `:id=1` gives the row `id` the value `1` and stores the segment as `:id`.
 */
export function splitPathVariables(url: string, vars: KeyValue[]): { url: string; path_variables: KeyValue[] } {
  const end = url.search(/[?#]/);
  const [path, rest] = end < 0 ? [url, ""] : [url.slice(0, end), url.slice(end)];
  const found: { key: string; value?: string }[] = [];
  const segments = path.split("/").map((seg) => {
    const m = PATH_VAR.exec(seg);
    if (!m) return seg;
    found.push({ key: m[1], value: m[2] });
    return `:${m[1]}`;
  });
  const names = found.map((f) => f.key);
  const path_variables = found
    .filter((f, i) => names.indexOf(f.key) === i)
    .map((f, i) => {
      const old = vars.find((v) => v.key === f.key) ?? (vars[i] && !names.includes(vars[i].key) ? vars[i] : undefined);
      const base = old ?? { id: crypto.randomUUID(), value: "", enabled: true };
      return { ...base, key: f.key, value: f.value ?? base.value };
    });
  return { url: segments.join("/") + rest, path_variables };
}

/** A piece of URL bar text: plain, a `{{variable}}`, or a `:name` Path Variable segment. */
export type UrlToken = { text: string; kind: null | "variable" | "path"; name: string };

/** Splits URL bar text for colouring, like Postman: `{{name}}` anywhere, `:name` (or `:name=value`) path segments. */
export function urlTokens(text: string): UrlToken[] {
  const out: UrlToken[] = [];
  const plain = (s: string) => s && out.push({ text: s, kind: null, name: "" });
  const end = text.search(/[?#]/);
  const pathEnd = end < 0 ? text.length : end;
  let i = 0;
  const re = /\{\{([^{}]*)\}\}|(?<=\/):[A-Za-z0-9_-]+(?:=[^/?#]*)?(?=[/?#]|$)/g;
  for (const m of text.matchAll(re)) {
    const at = m.index;
    if (m[1] === undefined && at >= pathEnd) continue;
    plain(text.slice(i, at));
    out.push(m[1] !== undefined ? { text: m[0], kind: "variable", name: m[1].trim() } : { text: m[0], kind: "path", name: PATH_VAR.exec(m[0])![1] });
    i = at + m[0].length;
  }
  plain(text.slice(i));
  return out;
}
