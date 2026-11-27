import { listen } from "@tauri-apps/api/event";

type TabNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * App commands. The ones in the macOS app menu (src-tauri/src/menu.rs) arrive as "menu" events;
 * the rest, and all of them on other platforms, come from `useShortcuts`' key handler.
 */
export type MenuCommand =
  | "tab:new"
  | "tab:save"
  | "tab:close"
  | "tab:force-close"
  | "tab:reopen"
  | "tab:next"
  | "tab:prev"
  | `tab:goto-${TabNumber}`
  | "request:send"
  | "request:focus-url"
  | "view:zoom-in"
  | "view:zoom-out"
  | "view:zoom-reset"
  | "view:toggle-sidebar"
  | "view:search"
  | "view:fullscreen"
  | "window:close"
  | "app:settings"
  | "app:shortcuts"
  | "app:about";

/** Calls `cb` for every app-menu command; resolves to the unsubscribe function. */
export const onMenuCommand = (cb: (c: MenuCommand) => void) => listen<MenuCommand>("menu", (e) => cb(e.payload));
