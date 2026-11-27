// Opens a link in the default browser (Tauri opener plugin). Only URLs allowed in capabilities/default.json open.
import { openUrl } from "@tauri-apps/plugin-opener";

export function openLink(url: string): Promise<void> {
  return openUrl(url);
}
