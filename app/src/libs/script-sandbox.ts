// The `zn` API a script sees (Postman's `pm` API under Zenar's name; `pm` stays an alias so
// scripts imported from Postman run unchanged), and running one script against it. Pure: no React, no
// Tauri. Runs inside the script Web Worker (`script-worker.ts`), never in the window itself (the window
// only parses a script with `syntaxError`, which compiles it without running it).
import type { KeyValue } from "@/bindings/KeyValue";

export type ScriptEvent = "pre-request" | "post-response";

export type ScriptRequest = { method: string; url: string; headers: KeyValue[]; body: string | null };
export type ScriptResponse = { status: number; time_ms: number; size_bytes: number; headers: { key: string; value: string }[]; body: string };

export type ScriptInput = {
  event: ScriptEvent;
  code: string;
  requestName: string;
  /** Environment + Captured Variables, resolved (Captured wins). */
  vars: Record<string, string>;
  request: ScriptRequest;
  response?: ScriptResponse;
};

export type ScriptLog = { level: "log" | "info" | "warn" | "error"; text: string };
export type TestResult = { name: string; passed: boolean; error?: string };

export type ScriptOutput = {
  /** `zn.variables` / `globals` / `collectionVariables` writes (last value wins); saved as Captured Variables. */
  set: Record<string, string>;
  unset: string[];
  /** `zn.environment` writes; saved to the active Environment. */
  envSet: Record<string, string>;
  envUnset: string[];
  /** The request after the script changed it (pre-request only). */
  request: ScriptRequest;
  logs: ScriptLog[];
  tests: TestResult[];
  /** Uncaught error or timeout. */
  error?: string;
};

class AssertionError extends Error {
  name = "AssertionError";
}

const show = (v: unknown): string => {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
};

// The script runs as the body of `new AsyncFunction(...params, code)`: engines count two header lines first.
const HEADER_LINES = 2;
const SOURCE_URL = "zenar-script";
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => (...a: unknown[]) => Promise<unknown>;
const PARAMS = ["zn", "pm", "postman", "console", "responseBody", "responseCode"];
const compile = (code: string) => new AsyncFunction(...PARAMS, `${code}\n//# sourceURL=${SOURCE_URL}`);

/**
 * The script line an error came from, when the engine tells: V8 names the sourceURL; JavaScriptCore
 * only sets `line` on the top frame, so it is used when that frame is the script (or its compile).
 */
function scriptLine(e: Error & { line?: number }, code: string): number | undefined {
  const stack = String(e.stack ?? "");
  const v8 = new RegExp(`${SOURCE_URL}:(\\d+):`).exec(stack);
  const jsc = typeof e.line === "number" && /^(anonymous|AsyncFunction)@/.test(stack) ? e.line : undefined;
  const line = v8 ? Number(v8[1]) : jsc;
  if (line === undefined) return undefined;
  return Math.min(Math.max(line - HEADER_LINES, 1), code.split("\n").length);
}

/** `TypeError: …` with the script line, and JavaScriptCore's "undefined is not an object" said as the missing key it is. */
function describeError(e: unknown, code: string): string {
  if (!(e instanceof Error)) return String(e);
  const jsc = /^(undefined|null) is not an object \(evaluating '(.+)\.([\w$]+)'\)$/.exec(e.message);
  const message = jsc ? `Cannot read "${jsc[3]}" of ${jsc[1]}: ${jsc[2]} does not exist` : e.message;
  const line = scriptLine(e, code);
  return `${e.name}: ${message}${line ? ` (line ${line})` : ""}`;
}

/** The syntax error in a script, without running it; null when it parses. */
export function syntaxError(code: string): string | null {
  try {
    compile(code);
    return null;
  } catch (e) {
    return describeError(e, code);
  }
}

const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/** The part of Chai's `expect` that Postman scripts use most: `.to.be.*`, `.to.have.*`, `.not`, `.eql`. */
function expect(actual: unknown, negate = false): Record<string, unknown> {
  const check = (ok: boolean, what: string) => {
    if (ok === negate) throw new AssertionError(`expected ${show(actual)} ${negate ? "not " : ""}${what}`);
  };
  const a = actual as { length?: number; includes?: (x: unknown) => boolean } & Record<string, unknown>;
  const api: Record<string, unknown> = {
    equal: (v: unknown) => check(actual === v, `to equal ${show(v)}`),
    eql: (v: unknown) => check(deepEqual(actual, v), `to deeply equal ${show(v)}`),
    a: (t: string) => check(typeOf(actual) === t.toLowerCase(), `to be a ${t}`),
    include: (v: unknown) =>
      check(
        typeof a?.includes === "function" ? a.includes(v) : typeof v === "object" && v !== null && Object.entries(v).every(([k, x]) => deepEqual(a?.[k], x)),
        `to include ${show(v)}`,
      ),
    property: (name: string, ...value: unknown[]) =>
      check(a != null && name in Object(a) && (value.length === 0 || deepEqual(a[name], value[0])), `to have property ${name}${value.length ? ` of ${show(value[0])}` : ""}`),
    lengthOf: (n: number) => check(a?.length === n, `to have length ${n}`),
    above: (n: number) => check((actual as number) > n, `to be above ${n}`),
    below: (n: number) => check((actual as number) < n, `to be below ${n}`),
    least: (n: number) => check((actual as number) >= n, `to be at least ${n}`),
    most: (n: number) => check((actual as number) <= n, `to be at most ${n}`),
    oneOf: (l: unknown[]) => check(l.some((x) => deepEqual(x, actual)), `to be one of ${show(l)}`),
    match: (re: RegExp) => check(re.test(String(actual)), `to match ${re}`),
  };
  // Every assertion returns the chain: `to.be.an("array").that.has.lengthOf(2)`.
  for (const [k, f] of Object.entries(api)) api[k] = (...args: unknown[]) => ((f as (...a: unknown[]) => void)(...args), api);
  api.equals = api.eq = api.equal;
  api.deep = { equal: api.eql };
  api.an = api.a;
  api.contain = api.contains = api.includes = api.include;
  api.length = api.lengthOf;
  api.greaterThan = api.gt = api.above;
  api.lessThan = api.lt = api.below;
  const flags: Record<string, [boolean, string]> = {
    ok: [!!actual, "to be truthy"],
    true: [actual === true, "to be true"],
    false: [actual === false, "to be false"],
    null: [actual === null, "to be null"],
    undefined: [actual === undefined, "to be undefined"],
    empty: [a != null && (typeof a === "object" && !Array.isArray(a) ? Object.keys(a).length === 0 : a.length === 0), "to be empty"],
    exist: [actual != null, "to exist"],
  };
  for (const [k, [ok, what]] of Object.entries(flags)) Object.defineProperty(api, k, { get: () => (check(ok, what), api) });
  // Chain words return the same object, so `to.be.an("array")` and `to.not.be.empty` read naturally.
  for (const w of ["to", "be", "been", "is", "that", "which", "and", "has", "have", "with", "at", "of", "same", "does"])
    Object.defineProperty(api, w, { get: () => api });
  Object.defineProperty(api, "not", { get: () => expect(actual, !negate) });
  return api;
}

/** A Postman header list over the Request's rows: disabled rows are kept but not seen. */
function headerList(rows: KeyValue[]) {
  const live = () => rows.filter((r) => r.enabled && r.key);
  const find = (k: string) => rows.findIndex((r) => r.enabled && r.key.toLowerCase() === k.toLowerCase());
  const toRow = (h: { key: string; value: string } | string, value?: string) =>
    typeof h === "string" ? { key: h, value: String(value ?? "") } : { key: h.key, value: String(h.value ?? "") };
  return {
    rows,
    get: (k: string) => rows[find(k)]?.value,
    has: (k: string) => find(k) >= 0,
    toObject: () => Object.fromEntries(live().map((r) => [r.key, r.value])),
    all: () => live().map((r) => ({ key: r.key, value: r.value })),
    each: (fn: (h: { key: string; value: string }) => void) => live().forEach((r) => fn({ key: r.key, value: r.value })),
    add: (h: { key: string; value: string } | string, value?: string) => rows.push({ id: crypto.randomUUID(), enabled: true, ...toRow(h, value) }),
    upsert: (h: { key: string; value: string } | string, value?: string) => {
      const row = toRow(h, value);
      const i = find(row.key);
      if (i >= 0) rows[i] = { ...rows[i], value: row.value };
      else rows.push({ id: crypto.randomUUID(), enabled: true, ...row });
    },
    remove: (k: string) => {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].key.toLowerCase() === k.toLowerCase()) rows.splice(i, 1);
    },
  };
}

export async function runScript(input: ScriptInput): Promise<ScriptOutput> {
  const vars = { ...input.vars };
  const set: Record<string, string> = {};
  const unset = new Set<string>();
  const envSet: Record<string, string> = {};
  const envUnset = new Set<string>();
  const logs: ScriptLog[] = [];
  const tests: TestResult[] = [];
  const pending: Promise<void>[] = [];
  const request: ScriptRequest = { ...input.request, headers: input.request.headers.map((h) => ({ ...h })) };

  // Every scope reads the same resolved values. `zn.environment` writes the active Environment, the
  // other scopes write Captured Variables (this machine only).
  const scopeOf = (name: string, written: Record<string, string>, removed: Set<string>) => ({
    get: (k: string) => vars[k],
    has: (k: string) => k in vars,
    set: (k: string, v: unknown) => {
      // Usually a key missing from the response (`jsonData.data.auth.accessTokn`): fail instead of saving "undefined".
      if (v === undefined) throw new TypeError(`zn.${name}.set("${k}"): the value is undefined (the key it was read from does not exist)`);
      const text = typeof v === "string" ? v : show(v);
      vars[k] = written[k] = text;
      removed.delete(k);
    },
    unset: (k: string) => {
      delete vars[k];
      delete written[k];
      removed.add(k);
    },
    toObject: () => ({ ...vars }),
    replaceIn: (t: string) => String(t).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k: string) => vars[k] ?? m),
  });
  const scope = scopeOf("variables", set, unset);
  const environment = scopeOf("environment", envSet, envUnset);

  const res = input.response;
  const resHeaders = res?.headers ?? [];
  const response = res && {
    code: res.status,
    status: res.status,
    responseTime: res.time_ms,
    responseSize: res.size_bytes,
    headers: {
      get: (k: string) => resHeaders.find((h) => h.key.toLowerCase() === k.toLowerCase())?.value,
      has: (k: string) => resHeaders.some((h) => h.key.toLowerCase() === k.toLowerCase()),
      toObject: () => Object.fromEntries(resHeaders.map((h) => [h.key, h.value])),
      all: () => resHeaders.map((h) => ({ ...h })),
    },
    text: () => res.body,
    json: () => {
      try {
        return JSON.parse(res.body);
      } catch (e) {
        throw new SyntaxError(`zn.response.json(): the response body is not JSON (${e instanceof Error ? e.message : e})`);
      }
    },
    to: {
      have: {
        status: (n: number) => {
          if (res.status !== n) throw new AssertionError(`expected response to have status ${n} but got ${res.status}`);
        },
        header: (k: string) => {
          if (!resHeaders.some((h) => h.key.toLowerCase() === k.toLowerCase())) throw new AssertionError(`expected response to have header ${k}`);
        },
      },
      be: {
        get ok() {
          if (res.status < 200 || res.status > 299) throw new AssertionError(`expected response to be ok but got ${res.status}`);
          return true;
        },
      },
    },
  };

  const headers = headerList(request.headers);
  // Before request there is no response yet: say so instead of "undefined is not an object".
  const noResponse = new Proxy(
    {},
    {
      get: () => {
        throw new Error("zn.response is only available in the After response script");
      },
    },
  );
  const pm = {
    info: { eventName: input.event === "pre-request" ? "prerequest" : "test", requestName: input.requestName },
    environment,
    collectionVariables: scope,
    globals: scope,
    variables: scope,
    request: {
      get url() {
        return request.url;
      },
      set url(u: string) {
        request.url = String(u);
      },
      get method() {
        return request.method;
      },
      set method(m: string) {
        request.method = String(m).toUpperCase();
      },
      headers,
      get body() {
        return { raw: request.body ?? "", toString: () => request.body ?? "" };
      },
    },
    response: response ?? noResponse,
    expect: (v: unknown) => expect(v),
    test: (name: string, fn: () => unknown) => {
      const record = (e?: unknown) => void tests.push(e === undefined ? { name, passed: true } : { name, passed: false, error: e instanceof Error ? e.message : String(e) });
      try {
        const r = fn();
        if (r instanceof Promise) pending.push(r.then(() => record(), record));
        else record();
      } catch (e) {
        record(e);
      }
    },
  };
  // Old-style Postman globals still common in shared collections.
  const postman = {
    setEnvironmentVariable: environment.set,
    getEnvironmentVariable: environment.get,
    clearEnvironmentVariable: environment.unset,
    setGlobalVariable: scope.set,
    getGlobalVariable: scope.get,
    clearGlobalVariable: scope.unset,
  };
  const log = (level: ScriptLog["level"]) => (...args: unknown[]) => logs.push({ level, text: args.map(show).join(" ") });
  const console = { log: log("log"), info: log("info"), debug: log("log"), warn: log("warn"), error: log("error") };

  let error: string | undefined;
  try {
    const fn = compile(input.code);
    await fn(pm, pm, postman, console, res?.body, res && { code: res.status });
    await Promise.all(pending);
  } catch (e) {
    error = describeError(e, input.code);
  }
  return { set, unset: [...unset], envSet, envUnset: [...envUnset], request, logs, tests, error };
}
