import { getCurrentWebview } from "@tauri-apps/api/webview";

/** Scales the whole interface, like a browser's zoom (1 = 100%). */
export const setWebviewZoom = async (scale: number) => getCurrentWebview().setZoom(scale);
