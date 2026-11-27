import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { App as AntApp } from "antd";
import { Marked, type Tokens } from "marked";
import { LuCopy } from "react-icons/lu";
import { IconButton, TOKEN_CLASS } from "@/components/ui";
import { highlightCode } from "@/libs/body-format";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const SAFE_LINK = /^(https?:|mailto:)/i;
const SAFE_IMAGE = /^(https?:|data:image\/)/i;

// The response is untrusted, and this renders in the app window (not a sandboxed frame, so code blocks can
// have a working Copy): raw HTML shows as text, and only http(s) / mailto links and http(s) / data images are kept.
const markdown = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }: Tokens.HTML | Tokens.Tag) => escape(text),
    link({ href, title, tokens }: Tokens.Link) {
      const text = this.parser.parseInline(tokens);
      if (!SAFE_LINK.test(href)) return text;
      return `<a href="${escape(href)}" title="${escape(title || href)}">${text}</a>`;
    },
    image({ href, title, text }: Tokens.Image) {
      if (!SAFE_IMAGE.test(href)) return escape(text);
      return `<img src="${escape(href)}" alt="${escape(text)}"${title ? ` title="${escape(title)}"` : ""}>`;
    },
    // A code block gets a header slot (language + Copy, filled by React) above its coloured code.
    code({ text, lang }: Tokens.Code) {
      const name = (lang ?? "").trim().split(/\s+/)[0] ?? "";
      const code = highlightCode(text.replace(/\n$/, ""), name)
        .map((line) => line.map((t) => (t.kind ? `<span class="${TOKEN_CLASS[t.kind]}">${escape(t.text)}</span>` : escape(t.text))).join(""))
        .join("\n");
      return (
        `<div class="my-3 overflow-hidden rounded-md border border-z-border bg-z-code">` +
        `<div data-code-head data-lang="${escape(name)}"></div>` +
        `<pre class="m-0 overflow-auto px-3 pt-0.5 pb-2.5"><code>${code}</code></pre></div>`
      );
    },
  },
});

/** Header of a code block: its language on the left, Copy on the right, like GitHub / VS Code previews. */
function CodeHead({ lang, code }: { lang: string; code: string }) {
  const { message } = AntApp.useApp();
  return (
    <div className="flex h-8 items-center justify-between pr-1 pl-3 font-sans text-sm text-z-muted">
      <span>{lang || "text"}</span>
      <IconButton
        label="Copy code"
        icon={<LuCopy />}
        onClick={() => navigator.clipboard?.writeText(code).then(() => message.success("Copied"), () => {})}
      />
    </div>
  );
}

/** Preview of a Markdown body, rendered in the app's theme; code blocks show their language and a Copy button. */
export function MarkdownPreview({ source }: { source: string }) {
  const html = useMemo(() => markdown.parse(source, { async: false }), [source]);
  const ref = useRef<HTMLDivElement>(null);
  const [heads, setHeads] = useState<{ node: Element; lang: string; code: string }[]>([]);

  useLayoutEffect(() => {
    const nodes = ref.current?.querySelectorAll("[data-code-head]") ?? [];
    setHeads(Array.from(nodes, (node) => ({ node, lang: node.getAttribute("data-lang") ?? "", code: node.nextElementSibling?.textContent ?? "" })));
  }, [html]);

  return (
    <div
      className="min-h-0 flex-1 overflow-auto rounded border border-z-border bg-z-bg px-5 py-4 text-md leading-[1.6] text-z-text select-text [&_a]:text-z-link [&_blockquote]:ml-0 [&_blockquote]:border-l-[3px] [&_blockquote]:border-z-border [&_blockquote]:pl-3 [&_blockquote]:text-z-muted [&_code]:font-mono [&_code]:text-code [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-z-code [&_:not(pre)>code]:px-[0.35em] [&_:not(pre)>code]:py-[0.1em] [&_h1]:border-b [&_h1]:border-z-border [&_h1]:pb-[0.3em] [&_h2]:border-b [&_h2]:border-z-border [&_h2]:pb-[0.3em] [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-z-border [&_img]:max-w-full [&_table]:border-collapse [&_td]:border [&_td]:border-z-border [&_td]:px-2.5 [&_td]:py-1 [&_th]:border [&_th]:border-z-border [&_th]:px-2.5 [&_th]:py-1"
      // Links never navigate the app window; the URL shows on hover.
      onClick={(e) => (e.target as Element).closest("a") && e.preventDefault()}
    >
      <div ref={ref} className="max-w-[860px]" dangerouslySetInnerHTML={{ __html: html }} />
      {heads.map((h, i) => createPortal(<CodeHead lang={h.lang} code={h.code} />, h.node, String(i)))}
    </div>
  );
}
