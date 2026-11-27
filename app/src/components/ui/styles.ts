// Tailwind class strings shared by several features (sidebar tree rows, labels, notes). A piece with
// markup of its own is a component instead (KvTable, IconButton, MethodTag...).
import { cx } from "@/libs/cx";

/**
 * A sidebar row (Collection, Folder, Request, Environment, History entry). Its level comes from the
 * `--depth` style and the sidebar's `--tree-indent`; never set a padding-left on a row.
 * Children react to its hover through `group/row` (see `rowMenuButton`).
 */
export const treeRow = ({
  active = false,
  picked = false,
  clickable = true,
}: { active?: boolean; picked?: boolean; clickable?: boolean } = {}) =>
  cx(
    "group/row relative flex h-7 items-center gap-1.5 rounded pr-1.5 pl-[calc(8px+var(--depth,0)*var(--tree-indent))] text-z-text transition-colors duration-[120ms]",
    clickable ? "cursor-pointer" : "cursor-default",
    // `picked` = part of a ⌘/Ctrl/Shift-click multi-selection; it wins over `active`.
    picked ? "bg-z-primary/15" : active ? "bg-z-active" : "hover:bg-z-hover",
  );

/** The "…" / pencil button at the end of a tree row: shown on row hover, keyboard focus, or while its menu is open. */
export const rowMenuButton =
  "inline-flex size-[22px] flex-none cursor-pointer items-center justify-center rounded border-0 bg-transparent text-z-muted opacity-0 hover:bg-z-active hover:text-z-text focus-visible:opacity-100 group-hover/row:opacity-100 [&.ant-dropdown-open]:opacity-100 disabled:cursor-not-allowed disabled:opacity-0!";

export const treeName = "min-w-0 flex-1 truncate";
export const treeIcon = "inline-flex flex-none text-z-muted";
export const treeChevron = "inline-flex w-3.5 flex-none text-z-muted";
/** Short note in a sidebar list or panel ("No Environments yet."). */
export const treeEmpty = "m-0 px-2.5 py-1.5 text-sm text-z-faint";
/** Unsaved-changes dot. */
export const dirtyDot = "size-[7px] flex-none rounded-full bg-z-dirty";
/** Label above a form field. */
export const fieldLabel = "mb-1 block text-sm text-z-muted";
/** Error / message text people may copy, kept on several lines. */
export const preWrap = "whitespace-pre-wrap break-words select-text";
/** Alert inside a sidebar list. */
export const sidebarAlert = "m-1";
/** Ant Tabs of the Request editor, Response and overview: tighter, Postman-like tab spacing. */
export const requestTabs = "[&_.ant-tabs-nav]:mb-2 [&_.ant-tabs-tab+.ant-tabs-tab]:ml-5";
