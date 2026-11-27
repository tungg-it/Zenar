import { useRef, useState } from "react";
import { Dropdown, type MenuProps } from "antd";
import { SHORTCUTS } from "@/libs/keys";
import type { MenuCommand } from "@/service/menu";
import { closeWindow, minimizeWindow, toggleMaximizeWindow } from "@/service/window";

type Entry = { key: string; label: string; keys?: string; run: () => void };
type Section = { title: string; groups: Entry[][] };

/** The element that had focus when a menu opened: Edit commands act on it, not on the menu item. */
function restoreFocus(el: HTMLElement | null) {
  el?.focus();
}


/**
 * File / Edit / View / Window / Help for Windows and Linux, which have no native menu bar. Same items and
 * keys as the macOS app menu (`src-tauri/src/menu.rs`): keep the two in step. Only each platform's own
 * conventions differ: macOS puts Settings and Quit in its Zenar menu, here Settings and Exit close File.
 */
export function AppMenu({ onCommand }: { onCommand: (c: MenuCommand) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const target = useRef<HTMLElement | null>(null);
  const c = (command: MenuCommand) => () => onCommand(command);
  // Read the target when the item is clicked, not when the menu is built.
  const exec = (cmd: string) => () => {
    restoreFocus(target.current);
    document.execCommand(cmd);
  };

  const sections: Section[] = [
    {
      title: "File",
      groups: [
        [
          { key: "new", label: "New Request", keys: SHORTCUTS.newRequest, run: c("tab:new") },
          { key: "save", label: "Save", keys: SHORTCUTS.save, run: c("tab:save") },
          { key: "send", label: "Send", keys: SHORTCUTS.send, run: c("request:send") },
        ],
        [
          { key: "reopen", label: "Reopen Closed Tab", keys: SHORTCUTS.reopenTab, run: c("tab:reopen") },
          { key: "close", label: "Close Tab", keys: SHORTCUTS.closeTab, run: c("tab:close") },
          { key: "force", label: "Force Close Tab", keys: SHORTCUTS.forceCloseTab, run: c("tab:force-close") },
          { key: "close-window", label: "Close Window", keys: SHORTCUTS.closeWindow, run: c("window:close") },
        ],
        [
          { key: "settings", label: "Settings…", keys: SHORTCUTS.settings, run: c("app:settings") },
          { key: "exit", label: "Exit", run: () => void closeWindow() },
        ],
      ],
    },
    {
      title: "Edit",
      groups: [
        [
          { key: "undo", label: "Undo", keys: "Ctrl+Z", run: exec("undo") },
          { key: "redo", label: "Redo", keys: "Ctrl+Shift+Z", run: exec("redo") },
        ],
        [
          { key: "cut", label: "Cut", keys: "Ctrl+X", run: exec("cut") },
          { key: "copy", label: "Copy", keys: "Ctrl+C", run: exec("copy") },
          {
            key: "paste",
            label: "Paste",
            keys: "Ctrl+V",
            run: () => {
              const el = target.current;
              void navigator.clipboard.readText().then((text) => {
                restoreFocus(el);
                document.execCommand("insertText", false, text);
              });
            },
          },
          { key: "all", label: "Select All", keys: "Ctrl+A", run: exec("selectAll") },
        ],
      ],
    },
    {
      title: "View",
      groups: [
        [
          { key: "zoom-reset", label: "Actual Size", keys: SHORTCUTS.zoomReset, run: c("view:zoom-reset") },
          { key: "zoom-in", label: "Zoom In", keys: SHORTCUTS.zoomIn, run: c("view:zoom-in") },
          { key: "zoom-out", label: "Zoom Out", keys: SHORTCUTS.zoomOut, run: c("view:zoom-out") },
        ],
        [
          { key: "sidebar", label: "Toggle Sidebar", keys: SHORTCUTS.toggleSidebar, run: c("view:toggle-sidebar") },
          { key: "search", label: "Search Requests", keys: SHORTCUTS.search, run: c("view:search") },
        ],
        [{ key: "fullscreen", label: "Toggle Full Screen", keys: SHORTCUTS.fullscreen, run: c("view:fullscreen") }],
      ],
    },
    {
      title: "Window",
      groups: [
        [
          { key: "next-tab", label: "Show Next Tab", keys: SHORTCUTS.nextTab, run: c("tab:next") },
          { key: "prev-tab", label: "Show Previous Tab", keys: SHORTCUTS.prevTab, run: c("tab:prev") },
        ],
        [
          { key: "minimize", label: "Minimize", run: () => void minimizeWindow() },
          { key: "maximize", label: "Maximize", run: () => void toggleMaximizeWindow() },
        ],
      ],
    },
    {
      title: "Help",
      groups: [
        [
          { key: "shortcuts", label: "Keyboard Shortcuts", keys: SHORTCUTS.shortcuts, run: c("app:shortcuts") },
        ],
        [
          { key: "about", label: "About Zenar", run: c("app:about") },
        ],
      ],
    },
  ];

  const items = (s: Section): MenuProps["items"] =>
    s.groups.flatMap((g, i) => [
      ...(i ? [{ type: "divider" as const, key: `${s.title}-d${i}` }] : []),
      ...g.map((e) => ({
        key: e.key,
        label: (
          <span className="flex min-w-44 items-center justify-between gap-6">
            {e.label}
            {e.keys && <span className="text-sm text-z-faint">{e.keys}</span>}
          </span>
        ),
      })),
    ]);

  return (
    <nav aria-label="Application menu" className="flex items-center">
      {sections.map((s) => (
        <Dropdown
          key={s.title}
          trigger={["click"]}
          open={open === s.title}
          onOpenChange={(o) => setOpen((cur) => (o ? s.title : cur === s.title ? null : cur))}
          menu={{
            items: items(s),
            onClick: ({ key }) => {
              setOpen(null);
              s.groups.flat().find((e) => e.key === key)?.run();
            },
          }}
        >
          <button
            type="button"
            // Keep the focus (and selection) of the field Edit acts on.
            onMouseDown={() => {
              if (open === null) target.current = document.activeElement as HTMLElement | null;
            }}
            // Once one menu is open, pointing at another opens it, like a native menu bar.
            onMouseEnter={() => open !== null && setOpen(s.title)}
            className={`h-6 cursor-default appearance-none rounded-none border-0 bg-transparent px-2.5 text-sm text-z-text outline-none transition-colors hover:bg-z-active focus-visible:bg-z-active ${open === s.title ? "bg-z-active" : ""}`}
          >
            {s.title}
          </button>
        </Dropdown>
      ))}
    </nav>
  );
}
