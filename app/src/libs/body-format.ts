import { parseAllDocuments } from "yaml";

// Response body views: detect the format, then turn the body into lines of coloured tokens.
// Pure functions, no React; colours come from the --z-code-* CSS variables via `TOKEN_CLASS` in components/ui/CodeView.

export type BodyFormat = "json" | "xml" | "html" | "yaml" | "javascript" | "markdown" | "text" | "hex" | "base64";

export type TokenKind = "key" | "string" | "number" | "bool" | "null" | "punct" | "tag" | "attr" | "link" | "comment" | "offset";
export type Token = { text: string; kind?: TokenKind };
export type Line = Token[];

/** Above this size text being typed is shown without colours, so the editor stays responsive. */
const HIGHLIGHT_LIMIT = 300_000;
/** Same for a response body, coloured once per Send: high enough for a full web page. */
const BODY_HIGHLIGHT_LIMIT = 1_000_000;

/** Pick the view from Content-Type, falling back to sniffing the body. */
export function detectFormat(contentType: string | undefined, body: string): BodyFormat {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("json")) return "json";
  if (ct.includes("html")) return "html";
  if (ct.includes("xml")) return "xml";
  if (ct.includes("yaml")) return "yaml";
  if (ct.includes("javascript") || ct.includes("ecmascript")) return "javascript";
  if (ct.includes("markdown")) return "markdown";
  const head = body.trimStart().slice(0, 64).toLowerCase();
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) return "html";
  if (head.startsWith("<")) return "xml";
  return "text";
}

/** The lines to show for `body` in `format`, and a note when the body is not valid for it. */
export function renderBody(body: string, format: BodyFormat): { lines: Line[]; note?: string } {
  switch (format) {
    case "json": {
      let pretty: string;
      try {
        pretty = JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        return { lines: plain(body), note: "Not valid JSON; showing the body as is." };
      }
      return { lines: pretty.length > BODY_HIGHLIGHT_LIMIT ? plain(pretty) : pretty.split("\n").map(jsonLine) };
    }
    case "xml": {
      const pretty = prettyXml(body);
      if (pretty === null) {
        return { lines: body.length > BODY_HIGHLIGHT_LIMIT ? plain(body) : markupLines(body.split("\n")), note: "Not well-formed XML; showing the body as is." };
      }
      return { lines: pretty.length > BODY_HIGHLIGHT_LIMIT ? plain(pretty) : markupLines(pretty.split("\n")) };
    }
    case "html": {
      const pretty = prettyHtml(body);
      return { lines: pretty.length > BODY_HIGHLIGHT_LIMIT ? plain(pretty) : markupLines(pretty.split("\n")) };
    }
    case "yaml":
      return { lines: body.length > BODY_HIGHLIGHT_LIMIT ? plain(body) : body.split("\n").map(yamlLine) };
    case "javascript":
      return { lines: body.length > BODY_HIGHLIGHT_LIMIT ? plain(body) : body.split("\n").map(jsLine) };
    case "markdown":
      return { lines: body.length > BODY_HIGHLIGHT_LIMIT ? plain(body) : markdownLines(body.split("\n")) };
    case "hex":
      return { lines: hexLines(body) };
    case "base64":
      return { lines: chunk(toBase64(body), 76).map((t) => [{ text: t }]) };
    default:
      return { lines: plain(body) };
  }
}

/** Formats whose views draw indent guides, like Postman's editor. */
export const GUIDED_FORMATS: ReadonlySet<BodyFormat> = new Set(["xml", "html", "yaml", "javascript"]);

/**
 * Indent guides per line, in characters: a guide every `unit` columns across the line's indentation.
 * `unit` is the smallest indentation used; a blank line takes the smaller indent of the lines around it,
 * so a guide runs unbroken from an opening line to its closing one.
 */
export function indentGuides(lines: Line[]): { unit: number; widths: number[] } {
  const indents = lines.map((l) => {
    const text = l.map((t) => t.text).join("");
    if (!text.trim()) return -1;
    let n = 0;
    while (text[n] === " " || text[n] === "\t") n++;
    return n;
  });
  const smallest = indents.reduce((m, n) => (n > 0 && n < m ? n : m), Infinity);
  const unit = smallest === Infinity ? 2 : Math.min(8, smallest);
  const near = (i: number, step: number) => {
    for (let j = i + step; j >= 0 && j < indents.length; j += step) if (indents[j] >= 0) return indents[j];
    return 0;
  };
  const widths = indents.map((n, i) => Math.floor((n < 0 ? Math.min(near(i, -1), near(i, 1)) : n) / unit) * unit);
  return { unit, widths };
}

const plain = (s: string): Line[] => s.split("\n").map((t) => [{ text: t }]);

/**
 * `yaml` as plain data for the Preview; several documents (`---`) become a list. Undefined when it does not parse.
 * Anchors and aliases are resolved, so `*ref` shows the data it points to.
 */
export function yamlToJson(yaml: string): { value: unknown } | undefined {
  try {
    const docs = parseAllDocuments(yaml);
    if (!Array.isArray(docs) || docs.some((d) => d.errors.length)) return undefined;
    const values = docs.map((d) => d.toJS({ maxAliasCount: 1000 }) as unknown);
    return { value: values.length === 1 ? values[0] : values };
  } catch {
    return undefined;
  }
}

/**
 * `xml` as plain data for the Preview, shaped like Postman's (xml2js): every child element is a list
 * of its occurrences, attributes go under `$`, text next to child elements under `_`.
 * Undefined when the body is not well-formed XML.
 */
export function xmlToJson(xml: string): { root: string; value: unknown } | undefined {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return undefined;
  return { root: doc.documentElement.nodeName, value: elementValue(doc.documentElement) };
}

function elementValue(el: Element): unknown {
  const out: Record<string, unknown> = {};
  if (el.attributes.length) out.$ = Object.fromEntries(Array.from(el.attributes, (a) => [a.name, a.value]));
  let text = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) ((out[node.nodeName] ??= []) as unknown[]).push(elementValue(node as Element));
    else if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) text += node.nodeValue ?? "";
  }
  text = text.trim();
  if (Object.keys(out).length === 0) return text;
  if (text) out._ = text;
  return out;
}

/** A start tag on one line: runs of spaces / line breaks between attributes become one space (quoted values kept). */
const tidyTag = (tag: string) => tag.replace(/("[^"]*"|'[^']*')|\s+/g, (m, quoted) => quoted ?? " ").replace(/ (?=\??>$)/, "");

// Comments, CDATA, <?…?>, <!…>, tags, then text runs.
const XML_PIECE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/?[^>]+>|[^<]+/g;

/** Re-indent `xml` one element per line, keeping `<a>text</a>` on one line; null when the tags don't balance. */
export function prettyXml(xml: string, indent = "  "): string | null {
  const pieces = (xml.match(XML_PIECE) ?? []).filter((p) => p.trim()).map((p) => (/^<[\w?]/.test(p) ? tidyTag(p) : p));
  const out: string[] = [];
  let depth = 0;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.startsWith("</")) {
      if (--depth < 0) return null;
      out.push(indent.repeat(depth) + p);
    } else if (!p.startsWith("<")) {
      out.push(indent.repeat(depth) + p.trim());
    } else if (p.startsWith("<!") || p.startsWith("<?") || p.endsWith("/>")) {
      out.push(indent.repeat(depth) + p);
    } else {
      // An element holding only text (or nothing) stays on one line.
      const next = pieces[i + 1];
      const after = pieces[i + 2];
      if (next?.startsWith("</")) {
        out.push(indent.repeat(depth) + p + next);
        i += 1;
      } else if (next !== undefined && !next.startsWith("<") && after?.startsWith("</")) {
        out.push(indent.repeat(depth) + p + next + after);
        i += 2;
      } else {
        out.push(indent.repeat(depth) + p);
        depth++;
      }
    }
  }
  return depth === 0 ? out.join("\n") : null;
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
// Elements whose content is kept byte for byte, matched whole before the other pieces.
const RAW_TAG = /^<(script|style|pre|textarea)\b/i;
const HTML_PIECE = new RegExp(`<(script|style|pre|textarea)\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>|${XML_PIECE.source}`, "gi");

// A start tag of one of these closes an open sibling of the same name (`<li>One<li>Two`).
const IMPLIED_END_TAGS = new Set(["li", "p", "tr", "td", "th", "option", "dt", "dd"]);

const tagName = (tag: string) => /^<\/?([\w:-]+)/.exec(tag)?.[1].toLowerCase() ?? "";

/**
 * Re-indent `html` one element per line, like prettyXml but forgiving: void tags never open a level,
 * a missing end tag (`<li>`, `<p>`) is closed by its parent's, and script / style / pre / textarea stay as sent.
 */
export function prettyHtml(html: string, indent = "  "): string {
  const pieces = (html.match(HTML_PIECE) ?? [])
    .filter((p) => p.trim())
    .map((p) => (/^<\w/.test(p) && !RAW_TAG.test(p) ? tidyTag(p) : p));
  const out: string[] = [];
  const open: string[] = [];
  const pad = () => indent.repeat(open.length);
  const text = (t: string) => t.trim().replace(/\s+/g, " ");
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const name = tagName(p);
    if (p.startsWith("</")) {
      const at = open.lastIndexOf(name);
      if (at >= 0) open.length = at;
      out.push(pad() + p);
    } else if (!p.startsWith("<")) {
      out.push(pad() + text(p));
    } else if (p.startsWith("<!") || p.startsWith("<?") || p.endsWith("/>") || VOID_TAGS.has(name) || RAW_TAG.test(p)) {
      out.push(pad() + p);
    } else {
      if (IMPLIED_END_TAGS.has(name) && open[open.length - 1] === name) open.pop();
      // An element holding only text (or nothing) stays on one line.
      const next = pieces[i + 1];
      const after = pieces[i + 2];
      if (next?.startsWith("</") && tagName(next) === name) {
        out.push(pad() + p + next);
        i += 1;
      } else if (next !== undefined && !next.startsWith("<") && after?.startsWith("</") && tagName(after) === name) {
        out.push(pad() + p + text(next) + after);
        i += 2;
      } else {
        out.push(pad() + p);
        open.push(name);
      }
    }
  }
  return out.join("\n");
}

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],])/g;

function jsonLine(line: string): Line {
  const out: Line = [];
  let last = 0;
  for (const m of line.matchAll(JSON_TOKEN)) {
    if (m.index! > last) out.push({ text: line.slice(last, m.index) });
    if (m[1] !== undefined) {
      out.push({ text: m[1], kind: m[2] ? "key" : "string" });
      if (m[2]) out.push({ text: m[2], kind: "punct" });
    } else if (m[3] !== undefined) out.push({ text: m[3], kind: "number" });
    else if (m[4] !== undefined) out.push({ text: m[4], kind: "bool" });
    else if (m[5] !== undefined) out.push({ text: m[5], kind: "null" });
    else out.push({ text: m[6], kind: "punct" });
    last = m.index! + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}

/**
 * Colour markup like Postman: `<tag`, `>` and `</tag>` in the tag colour, attribute names, values
 * (links underlined), comments. State carries across lines, so a tag spread over several lines,
 * a multi-line comment and the inside of <script> / <style> stay right.
 */
function markupLines(lines: string[]): Line[] {
  let inTag = false;
  let tag = "";
  // Inside a comment, CDATA or script / style: plain until `end`.
  let block: { end: string; kind?: TokenKind; keepEnd: boolean } | null = null;
  return lines.map((line) => {
    const out: Line = [];
    let i = 0;
    while (i < line.length) {
      if (block) {
        const at = line.indexOf(block.end, i);
        const stop = at < 0 ? line.length : at + (block.keepEnd ? block.end.length : 0);
        if (stop > i) out.push({ text: line.slice(i, stop), kind: block.kind });
        i = stop;
        if (at >= 0) block = null;
        continue;
      }
      const rest = line.slice(i);
      let m: RegExpExecArray | null;
      if (!inTag) {
        const lt = rest.search(/<(?=[\w/!?])/);
        if (lt < 0) {
          out.push({ text: rest });
          break;
        }
        if (lt > 0) out.push({ text: rest.slice(0, lt) });
        i += lt;
        const head = rest.slice(lt);
        if (head.startsWith("<!--")) block = { end: "-->", kind: "comment", keepEnd: true };
        else if (head.startsWith("<![CDATA[")) block = { end: "]]>", keepEnd: true };
        else {
          m = /^<[/!?]?[\w:.-]*/.exec(head)!;
          out.push({ text: m[0], kind: "tag" });
          tag = m[0].startsWith("</") ? "" : m[0].slice(1).toLowerCase();
          inTag = true;
          i += m[0].length;
        }
        continue;
      }
      if ((m = /^\s+/.exec(rest))) out.push({ text: m[0] });
      else if ((m = /^[?/]?>/.exec(rest))) {
        out.push({ text: m[0], kind: "tag" });
        inTag = false;
        if ((tag === "script" || tag === "style") && m[0] === ">") block = { end: `</${tag}`, keepEnd: false };
      } else if ((m = /^("[^"]*"?|'[^']*'?)/.exec(rest))) out.push({ text: m[0], kind: /^["']\s*https?:\/\//.test(m[0]) ? "link" : "string" });
      else if ((m = /^[^\s=>"'/?]+/.exec(rest))) out.push({ text: m[0], kind: "attr" });
      else {
        m = /^./.exec(rest)!;
        out.push({ text: m[0] });
      }
      i += m[0].length;
    }
    return out;
  });
}

const YAML_KEY = /^(\s*(?:- +)*)("(?:\\.|[^"\\])*"|'[^']*'|[^\s#'"{}[\],:&*!|>][^#:{}[\]]*?)(\s*:)(?=\s|$)/;
// Inside a flow collection ({ a: 1, b: [x] }) or after a list dash: the same kinds, token by token.
const YAML_TOKEN =
  /(^|\s)(#.*$)|("(?:\\.|[^"\\])*"|'(?:''|[^'])*')|(?<![\w.:/-])(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?![\w.:/-])|(?<![\w.-])(true|false|yes|no|on|off)(?![\w.-])|(?<![\w.-])(null|~)(?![\w.-])|([&*!][\w.-]+)|(^\s*-(?= |$)|^---|^\.\.\.|[{}[\],|>])/gi;

/** Kind of a whole plain value: number, boolean, null, else a string (as VS Code colours YAML). */
function yamlScalar(v: string): TokenKind {
  if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v) || /^0x[\da-f]+$/i.test(v)) return "number";
  if (/^(true|false|yes|no|on|off)$/i.test(v)) return "bool";
  if (/^(null|~)$/i.test(v)) return "null";
  return "string";
}

function yamlLine(line: string): Line {
  const out: Line = [];
  let rest = line;
  const key = YAML_KEY.exec(line);
  if (key) {
    if (key[1]) out.push({ text: key[1], kind: key[1].trim() ? "punct" : undefined });
    out.push({ text: key[2], kind: "key" }, { text: key[3], kind: "punct" });
    rest = line.slice(key[0].length);
  } else {
    const dash = /^(\s*(?:- +)+)/.exec(line);
    if (dash) {
      out.push({ text: dash[1], kind: "punct" });
      rest = line.slice(dash[1].length);
    }
  }
  // A plain value (not quoted, not a flow collection or block scalar) is one token, then its comment.
  const plainValue = /^(\s*)([^\s"'{[&*!|>#][^#]*?|[&*!][\w.-]+\s+[^\s"'{[#][^#]*?)(\s*)((?:\s#.*)?)$/.exec(rest);
  if (plainValue && !/^\s*(---|\.\.\.)\s*$/.test(rest)) {
    const [, pre, value, gap, comment] = plainValue;
    const anchor = /^([&*!][\w.-]+)(\s+)/.exec(value);
    const scalar = anchor ? value.slice(anchor[0].length) : value;
    out.push({ text: pre });
    if (anchor) out.push({ text: anchor[1], kind: "attr" }, { text: anchor[2] });
    out.push({ text: scalar, kind: yamlScalar(scalar) }, { text: gap });
    if (comment) out.push({ text: comment, kind: "comment" });
    return out.filter((t) => t.text);
  }
  out.push(...yamlTokens(rest));
  return out.filter((t) => t.text);
}

function yamlTokens(text: string): Line {
  const out: Line = [];
  let last = 0;
  for (const m of text.matchAll(YAML_TOKEN)) {
    const start = m.index! + (m[2] !== undefined ? m[1].length : 0);
    if (start > last) out.push({ text: text.slice(last, start) });
    const kind: TokenKind =
      m[2] !== undefined ? "comment" : m[3] ? "string" : m[4] ? "number" : m[5] ? "bool" : m[6] ? "null" : m[7] ? "attr" : "punct";
    const t = m[2] ?? m[0];
    out.push({ text: t, kind });
    last = start + t.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

// Inline Markdown: `code`, [text](url) / ![alt](url), **strong** / __strong__, *em* / _em_, <https://autolink>.
const MD_INLINE = /(`+)(.+?)\1|(!?\[)([^\]]*)(\]\()([^)\s]*)((?:\s+"[^"]*")?\))|(\*\*|__)(?=\S)(.+?)\8|(?<![\w*])([*_])(?=\S)(.+?)\10(?![\w*])|(<)(https?:\/\/[^>\s]+)(>)/g;

function markdownInline(text: string): Line {
  const out: Line = [];
  let last = 0;
  for (const m of text.matchAll(MD_INLINE)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    if (m[1]) out.push({ text: m[0], kind: "string" });
    else if (m[3]) out.push({ text: m[3], kind: "punct" }, { text: m[4], kind: "attr" }, { text: m[5], kind: "punct" }, { text: m[6], kind: "link" }, { text: m[7], kind: "punct" });
    else if (m[8]) out.push({ text: m[0], kind: "key" });
    else if (m[10]) out.push({ text: m[0], kind: "number" });
    else out.push({ text: m[12], kind: "punct" }, { text: m[13], kind: "link" }, { text: m[14], kind: "punct" });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Colour Markdown: headings, quotes, list markers, rules, fenced code (kept whole), then inline marks. */
function markdownLines(lines: string[]): Line[] {
  let fence: string | null = null;
  return lines.map((line) => {
    const open = /^\s*(```+|~~~+)/.exec(line);
    if (fence !== null) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && !line.trim().slice(open[1].length).trim()) fence = null;
      return [{ text: line, kind: fence === null ? "punct" : "string" }];
    }
    if (open) {
      fence = open[1];
      return [{ text: line, kind: "punct" }];
    }
    if (/^ {0,3}#{1,6}(\s|$)/.test(line)) return [{ text: line, kind: "tag" }];
    if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) return [{ text: line, kind: "punct" }];
    const lead = /^(\s*(?:>\s?)*)(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/.exec(line)!;
    const out: Line = [];
    if (lead[1]) out.push({ text: lead[1], kind: lead[1].includes(">") ? "comment" : undefined });
    if (lead[2]) out.push({ text: lead[2], kind: "punct" });
    out.push(...markdownInline(line.slice(lead[0].length)));
    return out.filter((t) => t.text);
  });
}

function hexLines(body: string): Line[] {
  const bytes = new TextEncoder().encode(body);
  const lines: Line[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const row = bytes.slice(i, i + 16);
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, "0")).join(" ").padEnd(47, " ");
    const ascii = Array.from(row, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    lines.push([{ text: i.toString(16).padStart(8, "0"), kind: "offset" }, { text: `  ${hex}  ` }, { text: ascii, kind: "string" }]);
  }
  return lines.length ? lines : [[{ text: "" }]];
}

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const chunk = (s: string, n: number) => (s.length ? (s.match(new RegExp(`.{1,${n}}`, "g")) ?? []) : [""]);

export type EditorLanguage = "json" | "javascript" | "html" | "xml" | "text" | "graphql";

/** Colour `text` line by line as typed, without reformatting it (for the request body editor). */
export function highlight(text: string, language: EditorLanguage): Line[] {
  const lines = text.split("\n");
  if (text.length > HIGHLIGHT_LIMIT) return lines.map((t) => [{ text: t }]);
  if (language === "json") return lines.map(jsonLine);
  if (language === "html" || language === "xml") return markupLines(lines);
  // GraphQL is close enough to JS for colouring: strings, numbers, punctuation, keywords.
  if (language === "javascript" || language === "graphql") return lines.map(jsLine);
  return lines.map((t) => [{ text: t }]);
}

/** Colour a fenced code block of a Markdown preview by its language name (```js, ```yml...); unknown ones stay plain. */
export function highlightCode(text: string, lang: string): Line[] {
  const lines = text.split("\n");
  if (text.length > HIGHLIGHT_LIMIT) return plain(text);
  switch (lang.toLowerCase()) {
    case "json":
    case "jsonc":
      return lines.map(jsonLine);
    case "html":
    case "xml":
    case "svg":
    case "vue":
      return markupLines(lines);
    case "yaml":
    case "yml":
      return lines.map(yamlLine);
    case "js":
    case "javascript":
    case "jsx":
    case "mjs":
    case "ts":
    case "typescript":
    case "tsx":
    case "graphql":
    case "gql":
      return lines.map(jsLine);
    case "md":
    case "markdown":
      return markdownLines(lines);
    default:
      return plain(text);
  }
}

const JS_TOKEN =
  /(\/\/.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\b(\d+(?:\.\d+)?)\b|\b(const|let|var|function|return|if|else|for|while|new|await|async|import|export|from|class|this|query|mutation|subscription|fragment|on)\b|\b(true|false|null|undefined)\b|([{}[\](),;:.=+\-*/<>!?&|])/g;

function jsLine(line: string): Line {
  const out: Line = [];
  let last = 0;
  for (const m of line.matchAll(JS_TOKEN)) {
    if (m.index! > last) out.push({ text: line.slice(last, m.index) });
    const kind: TokenKind = m[1] ? "comment" : m[2] ? "string" : m[3] ? "number" : m[4] ? "tag" : m[5] ? "bool" : "punct";
    out.push({ text: m[0], kind });
    last = m.index! + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}
