// Keyboard shortcut labels, in the platform's own notation. The keys follow Postman's.

export const isMac = /Mac/i.test(navigator.platform);

const k = (mac: string, other: string) => (isMac ? mac : other);

export const SHORTCUTS = {
  newRequest: k("⌘T", "Ctrl+T"),
  reopenTab: k("⇧⌘T", "Ctrl+Shift+T"),
  closeTab: k("⌘W", "Ctrl+W"),
  forceCloseTab: k("⌥⌘W", "Ctrl+Alt+W"),
  nextTab: k("⇧⌘]", "Ctrl+Shift+]"),
  prevTab: k("⇧⌘[", "Ctrl+Shift+["),
  gotoTab: k("⌘1 – ⌘8", "Ctrl+1 – Ctrl+8"),
  lastTab: k("⌘9", "Ctrl+9"),
  save: k("⌘S", "Ctrl+S"),
  send: k("⌘↵", "Ctrl+Enter"),
  focusUrl: k("⌘L", "Ctrl+L"),
  search: k("⌘K", "Ctrl+K"),
  toggleSidebar: k("⌘\\", "Ctrl+\\"),
  settings: k("⌘,", "Ctrl+,"),
  shortcuts: k("⌘/", "Ctrl+/"),
  zoomIn: k("⌘=", "Ctrl+="),
  zoomOut: k("⌘-", "Ctrl+-"),
  zoomReset: k("⌘0", "Ctrl+0"),
  closeWindow: k("⇧⌘W", "Ctrl+Shift+W"),
  fullscreen: k("⌃⌘F", "F11"),
};

/** A label split into the keys drawn as separate caps: "⇧⌘T" → ["⇧", "⌘", "T"], "Ctrl+Alt+W" → ["Ctrl", "Alt", "W"]. */
export function keyCaps(label: string): string[] {
  return isMac ? (label.match(/[⌃⌥⇧⌘]|[^⌃⌥⇧⌘]+/g) ?? []) : label.split(/\+(?!$)/);
}

// Windows and Linux have no app menu bar, so the window draws File / Edit / View / Help in a row above the
// top bar (`AppMenu`). macOS has its native menu bar (`src-tauri/src/menu.rs`).
const fakeMenu = import.meta.env.DEV && import.meta.env.VITE_FAKE_WINDOWS === "1"; // dev: `VITE_FAKE_WINDOWS=1 pnpm tauri dev` shows it on macOS
export const hasAppMenu = /Win|Linux/i.test(navigator.platform) || fakeMenu;
