import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { LuGripVertical } from "react-icons/lu";
import { cx } from "@/libs/cx";

/** Column sets of the key/value tables. */
const COLUMNS = {
  /** enabled checkbox, key (+ Text / File), value (+ remove on hover): form-data, laid out like `edit` */
  check: "grid-cols-[36px_1fr_1fr] [&>*]:flex [&>*]:min-w-0 [&>*]:items-center",
  /** enabled checkbox, key, value, description (+ remove on hover): Params, Headers, Path Variables */
  edit: "grid-cols-[36px_1fr_1fr_1fr] [&>*]:flex [&>*]:min-w-0 [&>*]:items-center",
  /** key, value (+ remove on hover): x-www-form-urlencoded, laid out like `edit` without the checkbox */
  pair: "grid-cols-[1fr_1fr] [&>*]:flex [&>*]:min-w-0 [&>*]:items-center",
  /** variable, JSONPath, description (+ remove on hover): Captures, laid out like `edit` without the checkbox */
  capture: "grid-cols-[1fr_1fr_1fr] [&>*]:flex [&>*]:min-w-0 [&>*]:items-center",
  /** variable, value, secret lock + remove on hover (Environment tab) */
  env: "grid-cols-[1fr_2fr_68px] [&>*]:flex [&>*]:min-w-0 [&>*]:items-center",
  /** read-only key and value (response headers, Captured Variables) */
  readonly: "grid-cols-[minmax(140px,1fr)_2fr]",
  /** read-only cookie attributes */
  cookie: "grid-cols-[1fr_2fr_1fr_0.6fr_1fr_0.6fr_0.6fr]",
} as const;

export type KvColumns = keyof typeof COLUMNS;

/** The row being dragged and where it would land. */
type Drag = { from: number; to: number };

type Reorder = {
  drag: Drag | null;
  start: (e: React.PointerEvent<HTMLElement>, from: number) => void;
  step: (from: number, by: number) => void;
};

const ReorderContext = createContext<Reorder | null>(null);

/**
 * Key/value table: a header row and lines of `KvRow`; an "Add" link button or a note may follow the rows.
 * With `onMove`, rows given an `index` get a grip on hover: drag it, or focus it and press ↑ / ↓, to move the row.
 */
export function KvTable({
  className,
  role,
  onMove,
  children,
}: {
  className?: string;
  role?: string;
  onMove?: (from: number, to: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const rows = () => [...(ref.current?.querySelectorAll<HTMLElement>(":scope > [data-kv-index]") ?? [])];

  // The moved row is a new element only when React remounts it; focus its grip again either way.
  const moveTo = (from: number, to: number) => {
    onMove?.(from, to);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`:scope > [data-kv-index="${to}"] [data-kv-grip]`)?.focus());
  };

  const reorder: Reorder | null = onMove
    ? {
        drag,
        step: (from, by) => {
          const to = from + by;
          if (to >= 0 && to < rows().length) moveTo(from, to);
        },
        start: (e, from) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const grip = e.currentTarget;
          grip.setPointerCapture(e.pointerId);
          let to = from;
          setDrag({ from, to });
          // The row lands past every row whose middle the pointer has crossed.
          const move = (ev: PointerEvent) => {
            to = from;
            for (const el of rows()) {
              const j = Number(el.dataset.kvIndex);
              const r = el.getBoundingClientRect();
              const mid = r.top + r.height / 2;
              if (j < from && ev.clientY < mid) to = Math.min(to, j);
              if (j > from && ev.clientY > mid) to = Math.max(to, j);
            }
            setDrag({ from, to });
          };
          const end = (ev: PointerEvent) => {
            grip.removeEventListener("pointermove", move);
            grip.removeEventListener("pointerup", end);
            grip.removeEventListener("pointercancel", end);
            setDrag(null);
            if (ev.type === "pointerup" && to !== from) moveTo(from, to);
          };
          grip.addEventListener("pointermove", move);
          grip.addEventListener("pointerup", end);
          grip.addEventListener("pointercancel", end);
        },
      }
    : null;

  return (
    <div
      ref={ref}
      className={cx(
        "flex flex-col items-stretch border-t border-z-border [&>.ant-btn-link]:mt-1 [&>.ant-btn-link]:self-start",
        drag && "cursor-grabbing select-none",
        className,
      )}
      role={role}
    >
      <ReorderContext.Provider value={reorder}>{children}</ReorderContext.Provider>
    </div>
  );
}

/** The drag grip of a movable row, in the gutter left of the table (its container's padding). */
function KvGrip({ index }: { index: number }) {
  const reorder = useContext(ReorderContext)!;
  return (
    <span
      role="button"
      tabIndex={0}
      data-kv-grip
      aria-label="Move row (drag, or press Up / Down)"
      className={cx(
        "absolute inset-y-0 right-full mr-px w-4 justify-center border-l-0! text-sm text-z-faint outline-none hover:text-z-text focus-visible:text-z-text focus-visible:opacity-100 touch-none",
        reorder.drag ? "cursor-grabbing" : "cursor-grab",
        reorder.drag?.from === index ? "opacity-100" : "opacity-0 group-hover/kv:opacity-100",
      )}
      onPointerDown={(e) => reorder.start(e, index)}
      onKeyDown={(e) => {
        const by = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
        if (!by) return;
        e.preventDefault();
        reorder.step(index, by);
      }}
    >
      <LuGripVertical />
    </span>
  );
}

/**
 * One row of a `KvTable`. `head` is the column titles; read-only columns pad their cells and
 * let people select the values. Cells are separated by a vertical line. `index` (the row's place
 * among the rows) makes it movable when the table has `onMove`.
 */
export function KvRow({
  columns,
  head = false,
  index,
  role,
  className,
  children,
}: {
  columns: KvColumns;
  head?: boolean;
  index?: number;
  role?: string;
  className?: string;
  children: ReactNode;
}) {
  const reorder = useContext(ReorderContext);
  const movable = reorder !== null && index !== undefined;
  const drag = movable ? reorder.drag : null;
  return (
    <div
      role={role}
      data-kv-index={movable ? index : undefined}
      className={cx(
        "grid border-b border-z-border [&>*+*]:border-l [&>*+*]:border-z-border [&>.ant-checkbox-wrapper]:justify-self-center",
        COLUMNS[columns],
        columns === "edit" || columns === "env" || columns === "capture" || columns === "check" || columns === "pair"
          ? "items-stretch"
          : "items-center",
        head
          ? "h-7 text-sm font-semibold text-z-muted [&>span]:px-[11px]"
          : "min-h-[30px] hover:bg-z-hover",
        !head &&
          columns === "readonly" &&
          "py-1.5 [&>*]:px-[11px] [&>*]:break-all [&>*]:select-text",
        !head &&
          columns === "cookie" &&
          "[&>*]:px-[11px] [&>*]:py-1 [&>*]:break-all [&>*]:select-text",
        movable && "group/kv relative",
        drag?.from === index && "bg-z-active opacity-60",
        // A line on the edge the dragged row would land against.
        drag && drag.to === index && drag.to !== drag.from &&
          (drag.to < drag.from ? "shadow-[inset_0_2px_0_var(--color-z-primary)]" : "shadow-[inset_0_-2px_0_var(--color-z-primary)]"),
        className,
      )}
    >
      {children}
      {movable && <KvGrip index={index} />}
    </div>
  );
}
