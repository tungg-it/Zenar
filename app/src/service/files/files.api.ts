// Native file picker (Tauri dialog plugin). Returns an absolute path on this machine, or null if cancelled.
import { open, save } from "@tauri-apps/plugin-dialog";

export async function pickFile(title: string): Promise<string | null> {
  const picked = await open({ title, multiple: false, directory: false });
  return typeof picked === "string" ? picked : null;
}

export async function pickFolder(title: string): Promise<string | null> {
  const picked = await open({ title, multiple: false, directory: true });
  return typeof picked === "string" ? picked : null;
}

export async function pickSavePath(title: string, defaultPath: string): Promise<string | null> {
  return save({ title, defaultPath, filters: [{ name: "JSON", extensions: ["json"] }] });
}
