import { Fragment, useMemo, useRef } from "react";
import { TOKEN_CLASS } from "@/components/ui";
import { cx } from "@/libs/cx";
import { highlight, type EditorLanguage, type Token } from "@/libs/body-format";
import { useHasVariable, VAR_KNOWN, VAR_UNKNOWN } from "./has-variable";
import { useVarSuggest } from "./VarSuggest";

// The coloured layer and the textarea must lay out text identically, so they share these classes.
const text = "m-0 px-3 py-(--ce-pad) [font:inherit] tracking-normal whitespace-pre [overflow-wrap:normal] [tab-size:2]";

type Piece = Token & { known?: boolean };

/** Re-cut a coloured line so each `{{variable}}` is its own piece, whatever tokens it spanned. */
function withVariables(line: Token[], has: (name: string) => boolean): Piece[] {
  const text = line.map((t) => t.text).join("");
  const vars = [...text.matchAll(/\{\{([^{}]*)\}\}/g)].map((m) => ({ from: m.index, to: m.index + m[0].length, known: has(m[1].trim()) }));
  if (!vars.length) return line;
  const out: Piece[] = [];
  let at = 0;
  for (const t of line) {
    const end = at + t.text.length;
    let i = at;
    while (i < end) {
      const v = vars.find((v) => v.to > i && v.from < end && v.from <= i);
      if (v) {
        // The variable's text from this token: appended to the piece already open for it.
        const piece = t.text.slice(i - at, Math.min(v.to, end) - at);
        const prev = out[out.length - 1];
        if (prev?.known === v.known && i > v.from) prev.text += piece;
        else out.push({ text: piece, known: v.known });
        i = Math.min(v.to, end);
      } else {
        const next = Math.min(end, ...vars.filter((v) => v.from > i).map((v) => v.from));
        out.push({ text: t.text.slice(i - at, next - at), kind: t.kind });
        i = next;
      }
    }
    at = end;
  }
  return out;
}

/**
 * Plain-text editor with line numbers and syntax colours: a transparent <textarea> on top of a
 * coloured copy of the same text, scrolled together. No editor library. With `variables`,
 * `{{variables}}` are coloured like in the URL bar and typing `{{` lists them. 280px high (drag the corner to resize) until the
 * Request editor / Response split is dragged; then it fills the height its parents leave it.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  label,
  variables = false,
  fill = false,
}: {
  value: string;
  onChange: (v: string) => void;
  language: EditorLanguage;
  label: string;
  /** Colour and suggest `{{variables}}` (request bodies; scripts are not substituted). */
  variables?: boolean;
  /** Take the height the parent's flex column leaves, at any size (the GraphQL query and variables). */
  fill?: boolean;
}) {
  const has = useHasVariable();
  const lines = useMemo(() => highlight(value, language).map((l): Piece[] => (variables ? withVariables(l, has) : l)), [value, language, has, variables]);
  const layer = useRef<HTMLDivElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const sync = () => {
    const { scrollTop = 0, scrollLeft = 0 } = area.current ?? {};
    if (layer.current) layer.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
    if (gutter.current) gutter.current.style.transform = `translateY(${-scrollTop}px)`;
  };
  const suggest = useVarSuggest({ input: () => (variables ? area.current : null), onChange, onInserted: sync });
  const { onAfterChange, onKeyDown: suggestKey, onBlur, ...aria } = suggest.inputProps;

  // Tab indents by two spaces instead of leaving the editor; Enter keeps the current indentation.
  // An open variable list takes ↑/↓, Enter, Tab and Esc first.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestKey(e)) return;
    const t = e.currentTarget;
    const { selectionStart: a, selectionEnd: b } = t;
    let insert: string;
    if (e.key === "Tab" && !e.shiftKey) insert = "  ";
    else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      const lineStart = value.lastIndexOf("\n", a - 1) + 1;
      const indent = /^[ \t]*/.exec(value.slice(lineStart, a))![0];
      // One level deeper after an opening bracket.
      insert = "\n" + indent + (/[{[(]\s*$/.test(value.slice(lineStart, a)) ? "  " : "");
    } else return;
    e.preventDefault();
    onChange(value.slice(0, a) + insert + value.slice(b));
    requestAnimationFrame(() => t.setSelectionRange(a + insert.length, a + insert.length));
  };

  return (
    <div
      className={cx(
        fill
          ? "min-h-[60px] flex-1"
          : "h-[280px] min-h-[120px] resize-y group-[.is-sized]/split:h-auto group-[.is-sized]/split:flex-1 group-[.is-sized]/split:resize-none",
        "relative flex overflow-hidden rounded border border-z-border bg-z-bg font-mono text-code leading-(--ce-line) [--ce-line:20px] [--ce-pad:8px] focus-within:border-z-border-strong",
      )}
    >
      <div className="w-11 flex-none overflow-hidden border-r border-z-border pt-(--ce-pad) text-z-faint" aria-hidden>
        <div ref={gutter}>
          {lines.map((_, i) => (
            <div key={i} className="h-(--ce-line) pr-2.5 text-right before:content-[attr(data-ln)]" data-ln={i + 1} />
          ))}
        </div>
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div ref={layer} className={`${text} pointer-events-none absolute top-0 left-0 min-w-full text-z-text`} aria-hidden>
          {lines.map((line, i) => (
            <div key={i} className="h-(--ce-line)">
              {line.map((t, j) => (
                <Fragment key={j}>
                  {t.known !== undefined ? (
                    <span className={t.known ? VAR_KNOWN : VAR_UNKNOWN}>{t.text}</span>
                  ) : t.kind ? (
                    <span className={TOKEN_CLASS[t.kind]}>{t.text}</span>
                  ) : (
                    t.text
                  )}
                </Fragment>
              ))}
              {"\n"}
            </div>
          ))}
        </div>
        <textarea
          ref={area}
          {...(variables && aria)}
          className={`${text} absolute inset-0 size-full resize-none overflow-auto border-0 bg-transparent text-transparent caret-z-text outline-none selection:bg-z-link/35 selection:text-transparent`}
          aria-label={label}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            onAfterChange();
          }}
          onScroll={sync}
          onKeyDown={onKeyDown}
          onKeyUp={onAfterChange}
          onClick={onAfterChange}
          onBlur={onBlur}
        />
        {suggest.popup}
      </div>
    </div>
  );
}
