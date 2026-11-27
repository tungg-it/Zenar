import { getCurrentWindow } from "@tauri-apps/api/window";

// Caption buttons of the custom title bar (Windows and Linux draw their own; see `WindowControls`).
export const minimizeWindow = async () => getCurrentWindow().minimize();
export const toggleMaximizeWindow = async () => getCurrentWindow().toggleMaximize();
export const closeWindow = async () => getCurrentWindow().close();
export const isWindowMaximized = async () => getCurrentWindow().isMaximized();
export const toggleFullscreen = async () => {
  const w = getCurrentWindow();
  await w.setFullscreen(!(await w.isFullscreen()));
};

/** Calls `cb` after every resize (maximize and restore too); returns the unsubscribe. */
export const onWindowResized = async (cb: () => void) => getCurrentWindow().onResized(cb);
