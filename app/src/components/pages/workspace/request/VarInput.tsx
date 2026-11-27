import { Fragment, useRef } from "react";
import { Input, type InputProps, type InputRef } from "antd";
import { cx } from "@/libs/cx";
import { useHasVariable, VAR_KNOWN, VAR_UNKNOWN, variableTokens, type VarToken } from "./has-variable";
import { useVarSuggest } from "./VarSuggest";

/**
 * A one-line field whose `{{variables}}` show blue when they have a value and red when they
 * don't, like the URL bar. A coloured copy of the text lies over the <input>, whose own text is
 * transparent; it does not take the mouse and scrolls with the input. `tokens` replaces the
 * default `{{variable}}` split (the URL bar also colours `:path` segments). Typing `{{` lists the
 * available variables (see `useVarSuggest`); with `bare` the field is one variable name.
 */
export function VarInput({
  value,
  onChange,
  tokens,
  mono = false,
  bare = false,
  rootClassName,
  className,
  ...rest
}: Omit<InputProps, "value" | "onChange" | "prefix" | "suffix" | "addonBefore" | "addonAfter"> & {
  value: string;
  onChange: (v: string) => void;
  tokens?: VarToken[];
  /** Code font, as in the URL bar and the token fields. */
  mono?: boolean;
  /** The field holds a variable name, not text with `{{variables}}` (see `useVarSuggest`). */
  bare?: boolean;
  /** Classes of the wrapper (sizing inside a grid cell). */
  rootClassName?: string;
}) {
  const has = useHasVariable();
  const parts = tokens ?? variableTokens(value, has);
  const input = useRef<InputRef>(null);
  const layer = useRef<HTMLDivElement>(null);
  const font = mono ? "font-mono text-code" : "font-sans text-base";
  // An <input> scrolls sideways on typing, caret moves and selection: follow it after each.
  const sync = () =>
    requestAnimationFrame(() => {
      const el = input.current?.input;
      if (el && layer.current) layer.current.style.transform = `translateX(${-el.scrollLeft}px)`;
    });
  const suggest = useVarSuggest({ input: () => input.current?.input, onChange, onInserted: sync, bare });
  const { onAfterChange, onKeyDown, onBlur, ...aria } = suggest.inputProps;

  return (
    <div className={cx("relative min-w-0 flex-1", rootClassName)}>
      <Input
        ref={input}
        {...rest}
        {...aria}
        // h-full: the code font's shorter line box would leave it lower than the Select / Button beside it.
        className={cx(font, "h-full text-transparent caret-z-text selection:bg-z-link/35 selection:text-transparent", className)}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onAfterChange();
          sync();
        }}
        onScroll={sync}
        onSelect={sync}
        // antd runs onPressEnter before onKeyDown: an open list takes Enter instead.
        onPressEnter={(e) => !suggest.shown && rest.onPressEnter?.(e)}
        onKeyDown={(e) => onKeyDown(e) || rest.onKeyDown?.(e)}
        onKeyUp={(e) => {
          sync();
          onAfterChange();
          rest.onKeyUp?.(e);
        }}
        onClick={(e) => {
          onAfterChange();
          rest.onClick?.(e);
        }}
        onBlur={(e) => {
          onBlur();
          rest.onBlur?.(e);
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      <div className="pointer-events-none absolute z-10 inset-y-px right-[11px] left-[12px] flex items-center overflow-hidden" aria-hidden>
        <div ref={layer} className={cx(font, "whitespace-pre text-z-text")}>
          {parts.map((t, i) =>
            t.known === undefined ? <Fragment key={i}>{t.text}</Fragment> : <span key={i} className={t.known ? VAR_KNOWN : VAR_UNKNOWN}>{t.text}</span>,
          )}
        </div>
      </div>
      {suggest.popup}
    </div>
  );
}
