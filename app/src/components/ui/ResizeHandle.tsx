import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "@/libs/cx";

const KEY_STEP = 16;

/**
 * Drag handle that sizes the element next to it: a sidebar's width ("x") or a pane's height ("y").
 * While dragging it sizes that element directly (no re-render per move); on release it reports the
 * size once, for the caller to store. Double-click puts the default size back. Arrow keys work too.
 */
export function ResizeHandle({
  axis,
  target,
  min,
  max,
  onResize,
  onReset,
  label,
}: {
  axis: "x" | "y";
  /** The element sized: the one before the handle, or the one after it (dragging toward it grows it). */
  target: "prev" | "next";
  min: number;
  max: number | (() => number);
  onResize: (size: number) => void;
  onReset: () => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number; size: number; el: HTMLElement } | null>(null);
  const prop = axis === "x" ? "width" : "height";
  const sign = target === "prev" ? 1 : -1;

  const element = () => (target === "prev" ? ref.current?.previousElementSibling : ref.current?.nextElementSibling) as HTMLElement | null;
  const clamp = (v: number) => Math.round(Math.max(min, Math.min(typeof max === "function" ? max() : max, v)));
  const pos = (e: PointerEvent) => (axis === "x" ? e.clientX : e.clientY);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    const el = element();
    if (e.button !== 0 || !el) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: pos(e), size: el.getBoundingClientRect()[prop], el };
    document.body.classList.add(`is-resizing-${axis}`);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    d.el.style[prop] = `${clamp(d.size + sign * (pos(e) - d.start))}px`;
    // The stylesheet's cap (e.g. the editor's 60%) would stop the drag short.
    d.el.style[axis === "x" ? "maxWidth" : "maxHeight"] = "none";
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    document.body.classList.remove(`is-resizing-${axis}`);
    const size = clamp(d.size + sign * (pos(e) - d.start));
    // Hand the size back to the caller's style; React renders it before the next paint.
    d.el.style[prop] = "";
    d.el.style[axis === "x" ? "maxWidth" : "maxHeight"] = "";
    if (size !== Math.round(d.size)) onResize(size);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const el = element();
    const keys = axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    const dir = keys.indexOf(e.key);
    if (!el || dir < 0) return;
    e.preventDefault();
    onResize(clamp(el.getBoundingClientRect()[prop] + sign * (dir === 0 ? -KEY_STEP : KEY_STEP)));
  }

  return (
    <div
      ref={ref}
      className={cx(
        // Zero size in the layout, a wider invisible grip over the border (::before), and a
        // primary-coloured line (::after) while hovered, focused or dragged.
        "relative z-[5] flex-none touch-none outline-none before:absolute before:content-[''] after:pointer-events-none after:absolute after:bg-z-primary after:opacity-0 after:transition-opacity after:delay-100 after:duration-150 after:content-[''] hover:after:opacity-100 focus-visible:after:opacity-100",
        axis === "x"
          ? "w-0 cursor-col-resize before:inset-x-[-4px] before:inset-y-0 after:inset-y-0 after:left-[-1px] after:w-0.5 [body.is-resizing-x_&:active]:after:opacity-100"
          : "h-0 cursor-row-resize before:inset-x-0 before:inset-y-[-4px] after:inset-x-0 after:top-[-1px] after:h-0.5 [body.is-resizing-y_&:active]:after:opacity-100",
      )}
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      title={`${label} (double-click to reset)`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
