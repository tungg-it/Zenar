import { useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/libs/cx";
import { VariableOptions, type VarOption } from "./has-variable";

const SOURCE = {
  environment: { badge: "E", title: "Environment", color: "bg-z-get/25 text-z-get" },
  captured: { badge: "C", title: "Captured Variable", color: "bg-z-link/25 text-z-link" },
} as const;

const WIDTH = 268;
const MAX_HEIGHT = 260;

type Field = HTMLInputElement | HTMLTextAreaElement;

/** `{{` opened before the caret and not closed: where it starts and what follows it so far. */
type Open = { start: number; query: string };

function openAt(el: Field, bare: boolean): Open | null {
  const caret = el.selectionStart ?? 0;
  if (caret !== el.selectionEnd) return null;
  const before = el.value.slice(0, caret);
  if (bare) {
    // The whole field is one name, typed with or without `{{`.
    const m = /^\s*(?:\{\{)?([^{}\s]*)$/.exec(before);
    return m && before && !el.value.slice(caret).trim() ? { start: 0, query: m[1] } : null;
  }
  const m = /\{\{([^{}\s]*)$/.exec(before);
  return m ? { start: m.index, query: m[1] } : null;
}

/** Names containing `query`, those starting with it first, each group by name. */
function filter(options: VarOption[], query: string) {
  const q = query.toLowerCase();
  const byName = (a: VarOption, b: VarOption) => a.name.localeCompare(b.name);
  const hits = options.filter((o) => o.name.toLowerCase().includes(q));
  const starts = hits.filter((o) => o.name.toLowerCase().startsWith(q)).sort(byName);
  return [...starts, ...hits.filter((o) => !o.name.toLowerCase().startsWith(q)).sort(byName)];
}

let canvas: HTMLCanvasElement | undefined;
function textWidth(text: string, el: HTMLElement) {
  const ctx = (canvas ??= document.createElement("canvas")).getContext("2d");
  if (!ctx) return 0;
  ctx.font = getComputedStyle(el).font;
  return ctx.measureText(text).width;
}

/** Where the text at `start` sits on screen: its left edge and the top / bottom of its line. */
function anchorOf(el: Field, start: number) {
  const box = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const left = box.left + el.clientLeft + parseFloat(cs.paddingLeft) - el.scrollLeft;
  if (el instanceof HTMLInputElement) return { x: left + textWidth(el.value.slice(0, start), el), top: box.top, bottom: box.bottom };
  // A <textarea> that does not wrap: the line of `start` and the text before it on that line.
  const lines = el.value.slice(0, start).split("\n");
  const line = parseFloat(cs.lineHeight);
  const top = box.top + el.clientTop + parseFloat(cs.paddingTop) + (lines.length - 1) * line - el.scrollTop;
  return { x: left + textWidth(lines[lines.length - 1].replace(/\t/g, "  "), el), top, bottom: top + line };
}

/**
 * Postman-style `{{` completion for an <input> or a <textarea>: typing `{{` lists the available
 * variables, narrowed by what follows, under the line being typed. ↑/↓ pick, Enter or Tab insert,
 * Esc closes. Spread `inputProps` on the field (after the caller's own handlers are merged in) and
 * render `popup`. With `bare` the field holds one variable name (Captures): typing lists matching
 * names, with or without `{{`, and picking one puts in the name alone.
 */
export function useVarSuggest({
  input,
  onChange,
  onInserted,
  bare = false,
}: {
  input: () => Field | null | undefined;
  onChange: (v: string) => void;
  /** After the caret moves into place (the coloured layer follows the field's scroll). */
  onInserted: () => void;
  bare?: boolean;
}) {
  const options = useContext(VariableOptions);
  const [open, setOpen] = useState<Open | null>(null);
  const [active, setActive] = useState(0);
  // Esc closes the list for this `{{` only; typing a new one opens it again.
  const dismissed = useRef<number | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const id = useId();
  const items = open ? filter(options, open.query) : [];
  // A bare name already typed in full needs no list.
  const shown = !!open && items.length > 0 && !(bare && items.length === 1 && items[0].name === open.query);
  const current = items[Math.min(active, items.length - 1)];

  function update() {
    const el = input();
    if (!el || document.activeElement !== el) return setOpen(null);
    const next = openAt(el, bare);
    if (!next || next.start === dismissed.current) {
      if (!next) dismissed.current = null;
      return setOpen(null);
    }
    if (next.start !== open?.start || next.query !== open.query) setActive(0);
    setOpen(next);
    const at = anchorOf(el, next.start);
    const left = Math.max(8, Math.min(at.x - 20, window.innerWidth - WIDTH - 8));
    const up = at.bottom + 6 + MAX_HEIGHT > window.innerHeight && at.top - 6 - MAX_HEIGHT > 0;
    setPos({ left, top: up ? at.top - 6 : at.bottom + 6, up });
  }

  function insert(o: VarOption) {
    const el = input();
    if (!el || !open) return;
    if (bare) {
      onChange(o.name);
      setOpen(null);
      requestAnimationFrame(() => {
        el.setSelectionRange(o.name.length, o.name.length);
        onInserted();
      });
      return;
    }
    const caret = el.selectionStart ?? el.value.length;
    // Inside an existing `{{name}}`: replace the rest of the name and its closing braces too.
    const rest = el.value.slice(caret);
    const tail = /^[^{}\s]*\}\}/.exec(rest)?.[0].length ?? 0;
    const text = `{{${o.name}}}`;
    onChange(el.value.slice(0, open.start) + text + rest.slice(tail));
    setOpen(null);
    const at = open.start + text.length;
    requestAnimationFrame(() => {
      el.setSelectionRange(at, at);
      onInserted();
    });
  }

  // Follow the field when something around it scrolls; close when the window resizes.
  useEffect(() => {
    if (!shown) return;
    const close = () => setOpen(null);
    document.addEventListener("scroll", update, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", close);
    };
  });

  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, shown]);

  const listId = `${id}-vars`;
  const optionId = (i: number) => `${id}-var-${i}`;

  return {
    /** The list is open: Enter belongs to it, not to the field's own Enter action. */
    shown,
    inputProps: {
      role: "combobox",
      "aria-autocomplete": "list" as const,
      "aria-expanded": shown,
      "aria-controls": shown ? listId : undefined,
      "aria-activedescendant": shown ? optionId(items.indexOf(current)) : undefined,
      onAfterChange: update,
      onKeyDown: (e: React.KeyboardEvent<Field>) => {
        if (!shown || e.nativeEvent.isComposing) return false;
        const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
        if (step) setActive((items.indexOf(current) + step + items.length) % items.length);
        else if (e.key === "Enter" || e.key === "Tab") insert(current);
        else if (e.key === "Escape") {
          dismissed.current = open.start;
          setOpen(null);
        } else return false;
        e.preventDefault();
        e.stopPropagation();
        return true;
      },
      onBlur: () => setOpen(null),
    },
    popup:
      shown &&
      pos &&
      createPortal(
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Variables"
          className="fixed z-[1100] flex flex-col overflow-y-auto rounded-lg border border-z-border-strong bg-z-elevated p-1.5 font-sans shadow-xl"
          style={{ left: pos.left, top: pos.top, width: WIDTH, maxHeight: MAX_HEIGHT, transform: pos.up ? "translateY(-100%)" : undefined }}
          // Keep the focus (and the caret) in the field.
          onMouseDown={(e) => e.preventDefault()}
        >
          {items.map((o, i) => {
            const on = o === current;
            const s = SOURCE[o.source];
            return (
              <div
                key={o.name}
                id={optionId(i)}
                role="option"
                aria-selected={on}
                className={cx(
                  // The picked row: filled, with an accent bar on the left that fades in.
                  "relative flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-150 ease-out",
                  "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-z-primary before:transition-opacity before:duration-150 before:content-['']",
                  on ? "bg-z-active before:opacity-100" : "before:opacity-0",
                )}
                onMouseMove={() => !on && setActive(i)}
                onClick={() => insert(o)}
              >
                <span title={s.title} className={cx("mt-0.5 inline-flex size-4 flex-none items-center justify-center rounded-[3px] text-2xs leading-none font-bold", s.color)}>
                  {s.badge}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx("block truncate text-base leading-5 text-z-text", on && "font-medium")}>{o.name}</span>
                  {/* The value opens under the picked row (0fr → 1fr rows animates to its own height). */}
                  <span
                    aria-hidden={!on}
                    className={cx("grid transition-[grid-template-rows,opacity] duration-150 ease-out", on ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}
                  >
                    <span className="overflow-hidden">
                      <span className={cx("block truncate text-sm leading-5", o.value && !o.secret ? "text-z-muted" : "text-z-faint italic")}>
                        {o.secret ? "••••••••" : o.value || "(empty)"}
                      </span>
                    </span>
                  </span>
                </span>
              </div>
            );
          })}
        </div>,
        document.body,
      ),
  };
}
