// Web Worker entry: runs one script, posts its ScriptOutput back. A worker has no Tauri IPC, so a
// script from a shared Collection cannot reach the app's commands; the window can stop it any time.
import { runScript, type ScriptInput } from "./script-sandbox";

self.onmessage = async (e: MessageEvent<ScriptInput>) => {
  self.postMessage(await runScript(e.data));
};
