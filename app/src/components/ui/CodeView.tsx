import { Fragment, useMemo, useRef, type ReactNode } from "react";
import { indentGuides, type Line, type TokenKind } from "@/libs/body-format";
import { cx } from "@/libs/cx";

/** Colour of each token kind; also used by CodeEditor's coloured layer. */
export const TOKEN_CLASS: Record<TokenKind, string> = {
  key: "text-z-code-key",
  string: "text-z-code-string",
  number: "text-z-code-number",
  bool: "text-z-code-bool",
  null: "text-z-code-bool",
  punct: "text-z-muted",
  tag: "text-z-code-tag",
  attr: "text-z-code-attr",
  link: "text-z-code-string underline",
  comment: "text-z-code-comment italic",
  offset: "text-z-faint",
};

/** Split `text` around case-insensitive matches of `q`, wrapping each match in <mark>. */
function mark(text: string, q: string): ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) {
    if (i > from) parts.push(text.slice(from, i));
    parts.push(<mark key={i} className="rounded-[2px] bg-z-search-hit text-inherit">{text.slice(i, i + q.length)}</mark>);
    from = i + q.length;
  }
  if (from === 0) return text;
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

/**
 * Read-only code with line numbers and token colours. `pane` fills and scrolls its parent (response
 * body); `inline` is as tall as its code, with a narrow gutter and wrapped lines hanging under their start
 * (Code snippet, like Postman).
 */
export function CodeView({
  lines,
  wrap,
  search = "",
  label = "Response body",
  variant = "pane",
  guides = false,
}: {
  lines: Line[];
  wrap: boolean;
  search?: string;
  label?: string;
  variant?: "pane" | "inline";
  /** Draw indent guides (vertical lines at each indent level), like Postman's editor. */
  guides?: boolean;
}) {
  const inline = variant === "inline";
  const q = search.toLowerCase();
  const ref = useRef<HTMLDivElement>(null);
  const guide = useMemo(() => (guides ? indentGuides(lines) : null), [guides, lines]);
  // Cmd/Ctrl+A selects the code only, not the whole window.
  const selectAll = (e: React.KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "a" || !ref.current) return;
    e.preventDefault();
    const range = document.createRange();
    range.selectNodeContents(ref.current);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };
  return (
    <div
      ref={ref}
      className={cx(
        "py-1.5 font-mono text-code leading-[1.6] text-z-text focus-visible:outline-none",
        inline ? "flex-none overflow-visible bg-transparent" : "min-h-0 flex-1 overflow-auto bg-z-bg",
      )}
      role="region"
      aria-label={label}
      tabIndex={0}
      onKeyDown={selectAll}
    >
      {lines.map((line, i) => (
        // The line number is CSS content (data-ln), so it is never selected or copied.
        <div
          className={cx(
            "flex before:flex-none before:text-right before:text-z-faint before:content-[attr(data-ln)] hover:bg-z-hover",
            inline ? "before:w-7 before:pr-2.5" : "before:w-11 before:pr-3",
          )}
          key={i}
          data-ln={i + 1}
        >
          <span className={cx("relative min-w-0 flex-1 select-text", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre", wrap && inline && "pl-[2ch] -indent-[2ch]")}>
            {guide && guide.widths[i] > 0 && (
              // One line every `unit` characters across the indentation, drawn by a repeating gradient.
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 bg-[linear-gradient(to_right,var(--z-border)_1px,transparent_1px)] bg-repeat-x"
                style={{ width: `${guide.widths[i]}ch`, backgroundSize: `${guide.unit}ch 100%` }}
              />
            )}
            {line.map((t, j) => (
              <Fragment key={j}>{t.kind ? <span className={TOKEN_CLASS[t.kind]}>{mark(t.text, q)}</span> : mark(t.text, q)}</Fragment>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
