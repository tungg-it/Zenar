// Environments and Secrets (ticket #11). Secret values live on this machine (app data dir); the active
// Environment is stored locally. Types come from Rust (src/bindings).
import { invoke } from "@tauri-apps/api/core";
import type { EnvImportPlan } from "@/bindings/EnvImportPlan";
import type { EnvironmentItem } from "@/bindings/EnvironmentItem";
import type { MissingSecret } from "@/bindings/MissingSecret";
import type { SharedSave } from "@/bindings/SharedSave";
import type { RequestItem } from "@/bindings/RequestItem";
import type { TargetChoice } from "@/bindings/TargetChoice";
import type { PlacedTokenWarning } from "@/bindings/PlacedTokenWarning";
import type { TokenWarning } from "@/bindings/TokenWarning";

export const getActiveEnvironment = (root: string) => invoke<string | null>("get_active_environment", { root });
export const setActiveEnvironment = (root: string, environmentId: string | null) =>
  invoke<void>("set_active_environment", { root, environmentId });
export const listMissingSecrets = (root: string) => invoke<MissingSecret[]>("list_missing_secrets", { root });
/** This person's Secret values of an Environment by variable id (unfilled ones left out). */
export const getSecretValues = (root: string, environment: EnvironmentItem) =>
  invoke<Record<string, string>>("get_secret_values", { root, environment });
export const setSecretValue = (root: string, environmentId: string, varId: string, value: string) =>
  invoke<void>("set_secret_value", { root, environmentId, varId, value });
/** Secret variables carry this person's value in `value`: a change from `base` is stored on this machine
 * (emptied: deleted), never in the repo. Values never loaded are sent empty in both, which keeps them. */
/** `base`: the Environment as loaded (null for a new one); other Members' edits are merged by variable. */
export const saveEnvironment = (root: string, base: EnvironmentItem | null, environment: EnvironmentItem, overwrite = false) =>
  invoke<SharedSave>("save_environment", { root, base, environment, overwrite });
/** Deletes it for every Member; on this machine its Secrets go too and it stops being the active one. */
export const deleteEnvironment = (root: string, environmentId: string) =>
  invoke<SharedSave>("delete_environment", { root, environmentId });
/** Shares `copy` (new id, name, order) as a new Environment; this person's Secrets of the source are copied to it. */
export const duplicateEnvironment = (root: string, sourceId: string, copy: EnvironmentItem) =>
  invoke<SharedSave>("duplicate_environment", { root, sourceId, copy });
export const checkTokenWarnings = (request: RequestItem) => invoke<TokenWarning[]>("check_token_warnings", { request });
/** Hard-coded credentials anywhere in the Collection (Requests, Folders, the Collection), before an export. */
export const exportTokenWarnings = (root: string) => invoke<PlacedTokenWarning[]>("export_token_warnings", { root });

// Environment files passed between Members by hand (ticket #24); the export carries Secret values.
/** What importing a Postman environment / `.env` text will do; writes nothing. */
export const planEnvironmentImport = (root: string, text: string, fileName: string, choice: TargetChoice) =>
  invoke<EnvImportPlan>("plan_environment_import", { root, text, fileName, choice });
/** Fill this person's Secrets of an existing Environment (this machine only). A new one is Saved with saveEnvironment. */
export const applyEnvironmentImport = (root: string, plan: EnvImportPlan) => invoke<void>("apply_environment_import", { root, plan });
export const exportEnvironment = (root: string, environmentId: string, path: string) =>
  invoke<void>("export_environment", { root, environmentId, path });
