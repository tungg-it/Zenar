import { invoke } from "@tauri-apps/api/core";
import type { CollectionData } from "@/bindings/CollectionData";
import type { LibraryEntry } from "@/bindings/LibraryEntry";

export const listCollections = () => invoke<LibraryEntry[]>("list_collections");
export type Author = { name: string; email: string };
/** Rejects with `AUTHOR_REQUIRED` when git has no commit author yet; retry with `author`. */
export const AUTHOR_REQUIRED = "AUTHOR_REQUIRED";
export const addCollection = (url: string, author: Author | null = null) => invoke<LibraryEntry>("add_collection", { url, author });
export const authorMissing = (id: string) => invoke<boolean>("author_missing", { id });
export const setAuthor = (id: string, author: Author) => invoke<void>("set_author", { id, author });
export const openCollectionById = (id: string) => invoke<CollectionData>("open_collection_by_id", { id });
export const removeCollection = (id: string, confirm: boolean) =>
  invoke<{ removed: boolean; unpushed: number }>("remove_collection", { id, confirm });
export const openInBrowser = (id: string) => invoke<void>("open_in_browser", { id });
