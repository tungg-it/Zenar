// Running Requests, plus per-machine state: TLS/proxy options, Captured Variables, history.
import { invoke } from "@tauri-apps/api/core";
import type { HistoryEntry } from "@/bindings/HistoryEntry";
import type { HttpRequest } from "@/bindings/HttpRequest";
import type { HttpResponse } from "@/bindings/HttpResponse";
import type { RequestItem } from "@/bindings/RequestItem";
import type { RequestPreview } from "@/bindings/RequestPreview";
import type { RunOptions } from "@/bindings/RunOptions";

export const sendRequest = (request: HttpRequest) => invoke<HttpResponse>("send_request", { request });
export const sendComposed = (root: string, request: RequestItem, environmentId: string | null) =>
  invoke<HttpResponse>("send_composed", { root, request, environmentId });
/** What Send would do (composed request + variables used), without sending. */
export const previewRequest = (root: string, request: RequestItem, environmentId: string | null) =>
  invoke<RequestPreview>("preview_request", { root, request, environmentId });
// Local store (this machine only): Captured Variables, history, TLS/proxy options.
export const getRunOptions = () => invoke<RunOptions>("get_run_options");
export const setRunOptions = (options: RunOptions) => invoke<void>("set_run_options", { options });
export const getCaptured = (root: string) => invoke<Record<string, string>>("get_captured", { root });
export const clearCaptured = (root: string) => invoke<void>("clear_captured", { root });
export const getHistory = (root: string) => invoke<HistoryEntry[]>("get_history", { root });
export const clearHistory = (root: string) => invoke<void>("clear_history", { root });
/** Save what a script set / unset; scripts write Captured Variables, never the shared Environment. */
export const applyScriptVars = (root: string, set: Record<string, string>, unset: string[]) =>
  invoke<void>("apply_script_vars", { root, set, unset });
