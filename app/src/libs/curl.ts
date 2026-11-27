// Turns a pasted cURL command into Request fields, like Postman's "paste cURL in the URL bar".
import type { Auth } from "@/bindings/Auth";
import type { FormField } from "@/bindings/FormField";
import type { KeyValue } from "@/bindings/KeyValue";
import type { RequestItem } from "@/bindings/RequestItem";
import { splitPathVariables, splitUrlParams } from "@/libs/url-params";

/** The Request fields a cURL command sets. */
export type CurlRequest = Pick<RequestItem, "method" | "url" | "params" | "path_variables" | "headers" | "body" | "body_type" | "body_extra"> & {
  auth?: Auth;
};

/** Whether pasted text looks like a cURL command (and not a URL). */
export const isCurl = (text: string) => /^\s*curl(\.exe)?\s/i.test(text);

/**
 * Splits a command line into words the way a POSIX shell does: '...', "..." (with \ escapes),
 * $'...' (C escapes), \ before a character, and line continuations (`\` or Windows `^` at line end).
 */
export function shellWords(text: string): string[] {
  const s = text.replace(/[\\^]\r?\n/g, " ");
  const out: string[] = [];
  let word: string | null = null;
  const add = (c: string) => (word = (word ?? "") + c);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (word !== null) out.push(word);
      word = null;
    } else if (c === "'") {
      const end = s.indexOf("'", i + 1);
      add(s.slice(i + 1, end < 0 ? s.length : end));
      i = end < 0 ? s.length : end;
    } else if (c === "$" && s[i + 1] === "'") {
      let j = i + 2;
      let v = "";
      for (; j < s.length && s[j] !== "'"; j++) {
        if (s[j] !== "\\") v += s[j];
        else v += ({ n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"' } as Record<string, string>)[s[++j]] ?? "\\" + (s[j] ?? "");
      }
      add(v);
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      let v = "";
      for (; j < s.length && s[j] !== '"'; j++) {
        // Inside "...", a backslash only escapes $ ` " \ (and a newline).
        if (s[j] === "\\" && '$`"\\'.includes(s[j + 1] ?? "")) v += s[++j];
        else v += s[j];
      }
      add(v);
      i = j;
    } else if (c === "\\" && i + 1 < s.length) {
      add(s[++i]);
    } else {
      add(c);
    }
  }
  if (word !== null) out.push(word);
  return out;
}

// curl options that take a value we don't use: skipped together with that value.
const SKIP_WITH_VALUE = new Set([
  "-o", "--output", "-m", "--max-time", "--connect-timeout", "-x", "--proxy", "-U", "--proxy-user",
  "--cacert", "--capath", "-E", "--cert", "--key", "--cert-type", "--key-type", "-w", "--write-out",
  "--retry", "--retry-delay", "--retry-max-time", "-c", "--cookie-jar", "-K", "--config", "-r", "--range",
  "--resolve", "--connect-to", "--interface", "-y", "--speed-time", "-Y", "--speed-limit", "--max-redirs",
  "-T", "--upload-file", "--limit-rate", "--max-filesize", "--proxy-header", "-D", "--dump-header",
  "--trace", "--trace-ascii", "--unix-socket", "--oauth2-bearer-skip",
]);
const DATA = new Set(["-d", "--data", "--data-raw", "--data-binary", "--data-ascii", "--json"]);

const row = (key: string, value: string): KeyValue => ({ id: crypto.randomUUID(), key, value, enabled: true });
const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
};

/** Parses a cURL command, or returns null when `text` is not one or has no URL. */
export function parseCurl(text: string): CurlRequest | null {
  if (!isCurl(text)) return null;
  const words = shellWords(text.trim()).slice(1);
  let method: string | null = null;
  let url = "";
  let head = false;
  let get = false;
  let json = false;
  const headers: KeyValue[] = [];
  const data: string[] = [];
  const encoded: string[] = [];
  const form: FormField[] = [];
  let auth: Auth | undefined;

  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    let value: string | undefined;
    // --opt=value and -Xvalue forms.
    if (w.startsWith("--") && w.includes("=")) [w, value] = [w.slice(0, w.indexOf("=")), w.slice(w.indexOf("=") + 1)];
    else if (/^-[XHdFuAbe]./.test(w)) [w, value] = [w.slice(0, 2), w.slice(2)];
    const next = () => value ?? words[++i] ?? "";

    if (w === "-X" || w === "--request") method = next().toUpperCase();
    else if (w === "-H" || w === "--header") {
      const h = next();
      const at = h.indexOf(":");
      if (at > 0) headers.push(row(h.slice(0, at).trim(), h.slice(at + 1).trim()));
    } else if (DATA.has(w)) {
      data.push(next());
      if (w === "--json") json = true;
    } else if (w === "--data-urlencode") encoded.push(next());
    else if (w === "-F" || w === "--form" || w === "--form-string") {
      const f = next();
      const at = f.indexOf("=");
      const [key, v] = at < 0 ? [f, ""] : [f.slice(0, at), f.slice(at + 1)];
      const file = w !== "--form-string" && v.startsWith("@");
      // `@path;type=...` names a file; keep only the path.
      form.push({ id: crypto.randomUUID(), key, value: file ? v.slice(1).split(";")[0] : v, type: file ? "file" : "text", enabled: true });
    } else if (w === "-u" || w === "--user") {
      const u = next();
      const at = u.indexOf(":");
      auth = { type: "basic", username: at < 0 ? u : u.slice(0, at), password: at < 0 ? "" : u.slice(at + 1) };
    } else if (w === "--oauth2-bearer") auth = { type: "bearer", token: next() };
    else if (w === "-A" || w === "--user-agent") headers.push(row("User-Agent", next()));
    else if (w === "-e" || w === "--referer") headers.push(row("Referer", next()));
    else if (w === "-b" || w === "--cookie") headers.push(row("Cookie", next()));
    else if (w === "-I" || w === "--head") head = true;
    else if (w === "-G" || w === "--get") get = true;
    else if (w === "--url") url = next();
    else if (SKIP_WITH_VALUE.has(w)) next();
    else if (w.startsWith("-") && w.length > 1) continue;
    else if (!url) url = w;
  }
  if (!url) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !url.startsWith("{{")) url = `http://${url}`;

  const header = (name: string) => headers.find((h) => h.key.toLowerCase() === name)?.value ?? "";
  if (json) {
    if (!header("content-type")) headers.push(row("Content-Type", "application/json"));
    if (!header("accept")) headers.push(row("Accept", "application/json"));
  }
  let body: string | null = null;
  let body_type: string | null = null;
  let body_extra: Record<string, unknown> | null = null;
  const pairs = [...data.flatMap((d) => d.split("&")).map((p) => [p, true] as const), ...encoded.map((p) => [p, false] as const)];

  if (get) {
    // -G sends the data as the query string.
    const query = pairs
      .filter(([p]) => p)
      .map(([p, isEncoded]) => {
        if (isEncoded) return p;
        const at = p.indexOf("=");
        return at < 0 ? encodeURIComponent(p) : `${p.slice(0, at)}=${encodeURIComponent(p.slice(at + 1))}`;
      })
      .join("&");
    if (query) url += (url.includes("?") ? "&" : "?") + query;
  } else if (form.length) {
    body_type = "formdata";
    body = "";
    body_extra = { fields: form };
  } else if (data.length || encoded.length) {
    const type = header("content-type").toLowerCase();
    if (!encoded.length && type && !type.includes("x-www-form-urlencoded")) {
      body = data.join("&");
      body_type = type.includes("json") ? "json" : type.includes("xml") ? "xml" : type.includes("html") ? "html" : type.includes("javascript") ? "javascript" : "text";
    } else if (!encoded.length && !type && /^\s*[[{]/.test(data.join(""))) {
      // JSON sent with curl's default Content-Type: keep it as raw JSON, like Postman.
      body = data.join("&");
      body_type = "json";
    } else {
      body_type = "form";
      // `name=value` pairs, values decoded (the backend encodes them on Send); --data-urlencode values are raw.
      body = pairs
        .filter(([p]) => p)
        .map(([p, isEncoded]) => {
          const at = p.indexOf("=");
          if (at < 0) return isEncoded ? decode(p) : `=${p}`;
          return `${isEncoded ? decode(p.slice(0, at)) : p.slice(0, at)}=${isEncoded ? decode(p.slice(at + 1)) : p.slice(at + 1)}`;
        })
        .join("\n");
    }
    // The body mode sets the Content-Type (the backend adds it): drop the pasted one when it would repeat it.
    if (body_type === "form" || body_type === "json") {
      const i = headers.findIndex((h) => h.key.toLowerCase() === "content-type" && /x-www-form-urlencoded|^application\/json$/i.test(h.value.trim()));
      if (i >= 0) headers.splice(i, 1);
    }
  }

  const query = splitUrlParams(url, []);
  const path = splitPathVariables(query.url, []);
  return {
    method: method ?? (head ? "HEAD" : body_type ? "POST" : "GET"),
    url: path.url,
    params: query.params.map((p) => ({ ...p, key: decode(p.key), value: decode(p.value) })),
    path_variables: path.path_variables,
    headers,
    body,
    body_type,
    body_extra,
    ...(auth ? { auth } : {}),
  };
}
