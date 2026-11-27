import { useEffect, useRef } from "react";
import { isMac } from "@/libs/keys";
import { onMenuCommand, type MenuCommand } from "@/service/menu";

// Commands that have an item in the macOS app menu: there the menu owns the key and sends the command.
const IN_MAC_MENU = new Set<MenuCommand>([
  "tab:new",
  "tab:save",
  "tab:close",
  "tab:force-close",
  "tab:reopen",
  "tab:next",
  "tab:prev",
  "request:send",
  "view:zoom-in",
  "view:zoom-out",
  "view:zoom-reset",
  "view:toggle-sidebar",
  "view:search",
  "window:close",
  "app:settings",
  "app:shortcuts",
]);

// ⌘ (Ctrl on Windows / Linux) + key → command, following Postman's keys. `e.code` is used where Shift
// changes `e.key` ("[" → "{"). "+" is Shift+= on most layouts, so Shift is allowed for zoom.
function commandFor(e: KeyboardEvent): MenuCommand | null {
  const k = e.key.toLowerCase();
  if (k === "=" || k === "+") return "view:zoom-in";
  if (k === "-" || k === "_") return "view:zoom-out";
  if (e.shiftKey) {
    if (e.code === "BracketRight") return "tab:next";
    if (e.code === "BracketLeft") return "tab:prev";
    if (k === "t" && !e.altKey) return "tab:reopen";
    if (k === "w" && !e.altKey) return "window:close";
    return null;
  }
  if (e.altKey) return k === "w" || e.code === "KeyW" ? "tab:force-close" : null;
  if (/^[1-9]$/.test(k)) return `tab:goto-${k}` as MenuCommand;
  if (k === "0") return "view:zoom-reset";
  if (k === "t") return "tab:new";
  if (k === "s") return "tab:save";
  if (k === "w") return "tab:close";
  if (k === "enter") return "request:send";
  if (k === "l") return "request:focus-url";
  if (k === "k") return "view:search";
  if (k === "\\") return "view:toggle-sidebar";
  if (k === ",") return "app:settings";
  if (k === "/") return "app:shortcuts";
  return null;
}

/**
 * App shortcuts, Postman's keys (see `SHORTCUTS` in libs/keys for the list). On macOS most of them
 * are app-menu items that arrive as menu commands; every other key is caught here.
 */
export function useShortcuts(handlers: Record<MenuCommand, () => void>) {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const unlisten = onMenuCommand((c) => latest.current[c]?.()).catch(() => () => {});
    const onKey = (e: KeyboardEvent) => {
      // F11 has no modifier; macOS uses its own Enter Full Screen item (⌃⌘F) instead.
      if (!isMac && e.key === "F11") {
        e.preventDefault();
        latest.current["view:fullscreen"]();
        return;
      }
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!mod) return;
      const c = commandFor(e);
      if (!c || (isMac && IN_MAC_MENU.has(c))) return;
      e.preventDefault();
      latest.current[c]();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      unlisten.then((f) => f());
    };
  }, []);
}
