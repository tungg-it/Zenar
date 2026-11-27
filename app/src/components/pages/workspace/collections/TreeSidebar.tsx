import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { App as AntApp, Dropdown, Input, type MenuProps } from "antd";
import { LuChevronDown, LuChevronRight, LuCopy, LuEllipsis, LuFilePlus, LuFolder, LuFolderOpen, LuFolderPlus, LuPencil, LuSlidersHorizontal, LuTrash2 } from "react-icons/lu";
import { saveBatch } from "@/service/collection";
import type { CollectionData } from "@/bindings/CollectionData";
import type { FolderItem } from "@/bindings/FolderItem";
import type { RequestItem } from "@/bindings/RequestItem";
import type { TreeChange } from "@/bindings/TreeChange";
import { dirtyDot, EllipsisText, MethodTag, requestTag, rowMenuButton, treeChevron, treeEmpty, treeIcon, treeName, treeRow } from "@/components/ui";
import { cx } from "@/libs/cx";
import { orderBetween } from "@/libs/order";

const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const inside = (path: string, folder: string) => folder === path || folder.startsWith(path + "/");
const byOrder = <T extends { order: number; name: string }>(a: T, b: T) => a.order - b.order || a.name.localeCompare(b.name);
const depthOf = (path: string) => (path === "" ? 0 : path.split("/").length);

// Tree row keys: "r:<request id>" / "f:<folder id>".
type Key = string;
// Where a drop lands, relative to the row under the pointer: above it, below it, or into a Folder.
type Pos = "before" | "after" | "into";
/**
 * A row's new state, shown before its save is done: a new place (the parent Folder's id, null = the root,
 * and order) or deleted (`gone`), under the row's key; a new name under "n:<id>".
 */
type Move = { parentId: string | null; order: number } | { gone: true } | { name: string };

/**
 * The Collection as it will be once the `moves` still saving are done: Folder paths below a moved Folder
 * change too, and everything inside a deleted Folder goes with it.
 */
function withMoves(c: CollectionData, moves: Map<Key, Move>): Pick<CollectionData, "folders" | "requests"> {
  if (!moves.size) return c;
  const idAt = new Map(c.folders.map((f) => [f.path, f.id]));
  const byId = new Map(c.folders.map((f) => [f.id, f]));
  const placed = (key: Key) => {
    const m = moves.get(key);
    return m && "parentId" in m ? m : undefined;
  };
  const gone = (key: Key) => {
    const m = moves.get(key);
    return !!m && "gone" in m;
  };
  // A rename only changes the shown name; the path keeps its old slug until the reload.
  const named = <T extends { id: string; name: string }>(x: T) => {
    const m = moves.get("n:" + x.id);
    return m && "name" in m ? m.name : x.name;
  };
  const parentId = (f: FolderItem) => {
    const m = placed("f:" + f.id);
    return m ? m.parentId : (idAt.get(parentOf(f.path)) ?? null);
  };
  const goneDir = (id: string | null): boolean => {
    const f = id ? byId.get(id) : undefined;
    return !!f && (gone("f:" + f.id) || goneDir(parentId(f)));
  };
  const paths = new Map<string, string>();
  const pathOf = (id: string | null): string => {
    const f = id ? byId.get(id) : undefined;
    if (!f) return "";
    let p = paths.get(f.id);
    if (p === undefined) {
      const up = pathOf(parentId(f));
      const name = f.path.slice(f.path.lastIndexOf("/") + 1);
      p = up ? `${up}/${name}` : name;
      paths.set(f.id, p);
    }
    return p;
  };
  return {
    folders: c.folders.filter((f) => !goneDir(f.id)).map((f) => ({ ...f, name: named(f), path: pathOf(f.id), order: placed("f:" + f.id)?.order ?? f.order })),
    requests: c.requests.flatMap((r) => {
      const m = placed("r:" + r.id);
      const dir = m ? m.parentId : (idAt.get(r.folder) ?? null);
      if (gone("r:" + r.id) || goneDir(dir)) return [];
      const folder = m || idAt.has(r.folder) ? pathOf(dir) : r.folder;
      return [{ ...r, name: named(r), folder, order: m?.order ?? r.order }];
    }),
  };
}
type Editing =
  | { kind: "new-folder"; parentPath: string }
  | { kind: "new-request"; parentPath: string }
  | { kind: "rename-folder"; id: string; name: string }
  | { kind: "rename-request"; id: string; name: string };

/** Actions the sidebar toolbar and the Collection menu trigger on the tree. */
export type TreeHandle = {
  /** Start naming a new Request / Folder in the selected Folder (or the Collection root). */
  startNew: (kind: "request" | "folder", parentPath?: string) => void;
  /** New items go to the Collection root again. */
  selectRoot: () => void;
  /** Save a copy of the Request next to it and open the copy. */
  duplicate: (r: RequestItem) => void;
};

type Props = {
  root: string;
  collection: CollectionData;
  selectedId: string | null;
  /** Request ids with an unsaved Draft (shown with a dot). */
  draftIds: Set<string>;
  /** Text from the sidebar filter box; empty shows everything. */
  filter: string;
  /** Reload the Collection after a change; `select` = a Request to open afterwards. */
  onChanged: (select?: RequestItem) => void | Promise<void>;
  onSelect: (r: RequestItem) => void;
  /** Show and open a new Request (created or duplicated) before its save finishes; `onChanged` follows. */
  onAdded: (r: RequestItem) => void;
  onEditDefaults: (folderPath: string) => void;
  onError: (message: string) => void;
  /** This Collection needs a newer app: no creating, renaming, moving or deleting. */
  readOnly?: boolean;
};

/**
 * Folder tree with create, rename, duplicate, delete and drag-and-drop move/reorder.
 * ⌘/Ctrl-click and Shift-click pick several rows; right-click, Delete or a drag then acts on all of them.
 */
export const TreeSidebar = forwardRef<TreeHandle, Props>(function TreeSidebar(
  { root, collection, selectedId, draftIds, filter, onChanged, onSelect, onAdded, onEditDefaults, onError, readOnly = false },
  ref,
) {
  const { modal } = AntApp.useApp();
  const [editing, setEditing] = useState<Editing | null>(null);
  // The rows being dragged (one row, or the whole multi-selection when a picked row is dragged).
  const [drag, setDrag] = useState<Key[] | null>(null);
  const [target, setTarget] = useState<{ key: Key; pos: Pos } | null>(null);
  const [parentPath, setParentPath] = useState("");
  // New Folders shown before their commit and push finish; dropped once the reload has them (or the save failed).
  const [pending, setPending] = useState<FolderItem[]>([]);
  // Expanded Folders, by path. Folders start collapsed, like Postman.
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Multi-selection: the picked rows, and the row a Shift-click range starts from.
  const [picked, setPicked] = useState<Set<Key>>(new Set());
  const [anchor, setAnchor] = useState<Key | null>(null);
  const treeEl = useRef<HTMLDivElement>(null);
  // Drops are shown at once (`moves`) and saved in the background, one batch after another (`saving`).
  const [moves, setMoves] = useState<Map<Key, Move>>(new Map());
  const saving = useRef<Promise<void>>(Promise.resolve());
  const doneMoves = useRef(new Set<Move>());
  const pruneMoves = () =>
    setMoves((m) => (![...m.values()].some((x) => doneMoves.current.has(x)) ? m : new Map([...m].filter(([, x]) => !doneMoves.current.has(x)))));
  // A saved batch keeps its moves until the reloaded Collection has them, so the rows never jump back.
  useEffect(pruneMoves, [collection]);
  // The newest saved copy of each Request: a later save of it must start from there, not from a stale load.
  const latest = useRef(new Map<string, RequestItem>());
  const current = useRef(collection);
  useEffect(() => {
    current.current = collection;
    latest.current.clear();
  }, [collection]);
  const baseOf = (r: RequestItem) => latest.current.get(r.id) ?? current.current.requests.find((x) => x.id === r.id) ?? r;
  // What the tree shows: the Collection with the drops still saving.
  const items = useMemo(() => withMoves(collection, moves), [collection, moves]);

  const folderAt = (path: string) => items.folders.find((f) => f.path === path);
  const requestsIn = (path: string) => items.requests.filter((r) => r.folder === path).sort(byOrder);
  const folders = [...items.folders, ...pending.filter((p) => !items.folders.some((f) => f.id === p.id))];
  const isPending = (f: FolderItem) => pending.some((p) => p.id === f.id) && !items.folders.some((x) => x.id === f.id);
  const foldersIn = (path: string) => folders.filter((f) => parentOf(f.path) === path).sort(byOrder);

  const expand = (path: string) =>
    setOpen((s) => {
      const n = new Set(s);
      for (let p = path; p; p = parentOf(p)) n.add(p);
      return n;
    });

  useImperativeHandle(ref, () => ({
    startNew: (kind, at = parentPath) => {
      if (readOnly) return;
      if (at) expand(at);
      setEditing({ kind: kind === "request" ? "new-request" : "new-folder", parentPath: at });
    },
    selectRoot: () => setParentPath(""),
    duplicate: (r) => {
      if (!readOnly) duplicate(r);
    },
  }));

  // Reveal the selected Request (e.g. picked from search or a tab).
  useEffect(() => {
    const r = items.requests.find((x) => x.id === selectedId);
    if (r?.folder) expand(r.folder);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = filter.trim().toLowerCase();
  const matches = (r: RequestItem) => !q || r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q);
  const folderVisible = (f: FolderItem) =>
    !q || f.name.toLowerCase().includes(q) || items.requests.some((r) => inside(f.path, r.folder) && matches(r));
  const isOpen = (path: string) => !!q || open.has(path);

  // A filter hides rows: never act on picked rows the person cannot see.
  useEffect(() => setPicked(new Set()), [q]);

  // Row keys in the order they are shown (expanded Folders only, saved Folders only).
  function visibleKeys(path = ""): Key[] {
    const out: Key[] = [];
    for (const f of foldersIn(path)) {
      if (!folderVisible(f) || isPending(f)) continue;
      out.push("f:" + f.id);
      if (isOpen(f.path)) out.push(...visibleKeys(f.path));
    }
    for (const r of requestsIn(path)) if (matches(r)) out.push("r:" + r.id);
    return out;
  }

  /** ⌘/Ctrl-click toggles a row, Shift-click picks a range; returns true when the click was one of those. */
  function pickClick(e: React.MouseEvent, key: Key) {
    const from = anchor ?? (selectedId ? "r:" + selectedId : null);
    if (e.shiftKey && from) {
      const keys = visibleKeys();
      const a = keys.indexOf(from);
      const b = keys.indexOf(key);
      if (a >= 0 && b >= 0) {
        setPicked(new Set(keys.slice(Math.min(a, b), Math.max(a, b) + 1)));
        return true;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      setPicked((s) => {
        const n = new Set(s.size || !from ? s : [from]);
        n.has(key) ? n.delete(key) : n.add(key);
        return n;
      });
      setAnchor(key);
      return true;
    }
    setPicked(new Set());
    setAnchor(key);
    return false;
  }

  // The picked items that still exist, without those inside a picked Folder (they go with it).
  function pickedRoots(keys: Iterable<Key>) {
    const ks = new Set(keys);
    const fs = items.folders.filter((f) => ks.has("f:" + f.id));
    const under = (folder: string) => fs.some((f) => inside(f.path, folder));
    return {
      folders: fs.filter((f) => !under(parentOf(f.path))),
      requests: items.requests.filter((r) => ks.has("r:" + r.id) && !under(r.folder)).sort(byOrder),
    };
  }

  /**
   * Show `shown` at once and save `changes` behind it as one commit and one push (`saveBatch`), after any
   * earlier batch. A change built from a function reads its base when its batch starts, so it sees the
   * saves before it. Conflicting changes are left out and reported; the reload then shows the real tree.
   */
  function saveInBackground(shown: Map<Key, Move>, changes: { name: string; change: () => TreeChange }[]) {
    if (!changes.length) return Promise.resolve();
    setMoves((m) => new Map([...m, ...shown]));
    setPicked(new Set());
    return (saving.current = saving.current.then(async () => {
      try {
        const r = await saveBatch(root, changes.map((c) => c.change()));
        for (const x of r.saved) latest.current.set(x.id, x);
        if (r.conflicts.length) {
          const names = r.conflicts.map((c) => `"${changes[c.index].name}"`).join(", ");
          onError(`Someone else changed ${names} meanwhile, so ${r.conflicts.length === 1 ? "it was" : "they were"} not changed. Reloaded.`);
        }
      } catch (e) {
        onError(String(e));
      }
      await Promise.resolve(onChanged()).catch(() => {});
      for (const m of shown.values()) doneMoves.current.add(m);
      // Normally the reload prunes them (effect on `collection`); this covers a reload that failed.
      setTimeout(pruneMoves, 1500);
    }));
  }

  // A new or duplicated Request is already shown and open (`onAdded`); this saves it behind it.
  const createInBackground = (r: RequestItem) =>
    saveInBackground(new Map(), [{ name: r.name, change: () => ({ kind: "request", change: { kind: "create", ...r }, folder_id: folderAt(r.folder)?.id ?? null }) }]);

  function deletePicked() {
    const { folders: fs, requests: rs } = pickedRoots(picked);
    if (!fs.length && !rs.length) return;
    const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
    const what = [fs.length && count(fs.length, "folder"), rs.length && count(rs.length, "request")].filter(Boolean).join(" and ");
    confirmDelete(`${what}${fs.length ? " and everything in them" : ""}`, () => deleteInBackground(rs, fs));
  }

  /** Hide the rows at once and delete them behind it, in one commit (a single row too). */
  const deleteInBackground = (rs: RequestItem[], fs: FolderItem[]) =>
    saveInBackground(new Map([...rs.map((r) => "r:" + r.id), ...fs.map((f) => "f:" + f.id)].map((k) => [k, { gone: true }])), [
      ...rs.map((r) => ({ name: r.name, change: (): TreeChange => ({ kind: "request", change: { kind: "delete", base: baseOf(r) }, folder_id: null }) })),
      ...fs.map((f) => ({
        name: f.name,
        change: (): TreeChange => ({
          kind: "folder",
          op: { kind: "delete", id: f.id, known_request_ids: items.requests.filter((r) => inside(f.path, r.folder)).map((r) => r.id) },
        }),
      })),
    ]);

  // Esc drops the multi-selection; Delete or ⌘/Ctrl+Backspace deletes it. Only while focus is on the
  // page or the tree (tree rows take no focus), never while typing or in a dialog.
  useEffect(() => {
    if (!picked.size) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t !== document.body && !treeEl.current?.contains(t)) return;
      if (t?.closest("input, textarea")) return;
      if (e.key === "Escape") setPicked(new Set());
      else if (!readOnly && (e.key === "Delete" || (e.key === "Backspace" && (e.metaKey || e.ctrlKey)))) {
        e.preventDefault();
        deletePicked();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /**
   * Moves the dragged rows into the Folder at `path` (the root = ""). With `at`, they go just before / after that
   * row: Requests among the Requests, Folders among the Folders (each list keeps its own order). Without it,
   * they go to the end, and rows already in `path` stay where they are.
   */
  function place(keys: Key[], path: string, at?: { item: RequestItem | FolderItem; pos: "before" | "after" }) {
    if (at && keys.includes(("folder" in at.item ? "r:" : "f:") + at.item.id)) return;
    const { folders: fs, requests: rs } = pickedRoots(keys);
    const folderId = folderAt(path)?.id ?? null;

    // Orders for `n` items placed at `at` in `sibs` (the list without the moved items), or at its end.
    const ordersIn = <T extends { id: string; order: number }>(sibs: T[], n: number, anchor?: T) => {
      const i = anchor ? sibs.findIndex((x) => x.id === anchor.id) + (at?.pos === "after" ? 1 : 0) : sibs.length;
      let lo = i > 0 ? sibs[i - 1].order : null;
      const hi = i < sibs.length ? sibs[i].order : null;
      return Array.from({ length: n }, () => (lo = orderBetween(lo, hi)));
    };

    const reqAnchor = at && "folder" in at.item ? (at.item as RequestItem) : undefined;
    const reqs = rs.filter((r) => reqAnchor || r.folder !== path);
    const reqOrders = ordersIn(requestsIn(path).filter((x) => !reqs.some((r) => r.id === x.id)), reqs.length, reqAnchor);
    const reqMoves = reqs.map((r, i) => ({
      name: r.name,
      change: (): TreeChange => {
        const base = baseOf(r);
        return { kind: "request", change: { kind: "update", base, ours: { ...base, folder: path, order: reqOrders[i] } }, folder_id: folderId };
      },
    }));

    // A Folder never goes into itself or one of its sub-Folders.
    const dirAnchor = at && !("folder" in at.item) ? (at.item as FolderItem) : undefined;
    const dirs = fs.filter((f) => !inside(f.path, path) && (dirAnchor || parentOf(f.path) !== path));
    const dirOrders = ordersIn(foldersIn(path).filter((x) => !dirs.some((f) => f.id === x.id)), dirs.length, dirAnchor);
    const dirMoves = dirs.flatMap((f, i) => [
      ...(parentOf(f.path) !== path ? [{ name: f.name, change: (): TreeChange => ({ kind: "folder", op: { kind: "move", id: f.id, parent_id: folderId } }) }] : []),
      ...(dirAnchor ? [{ name: f.name, change: (): TreeChange => ({ kind: "folder", op: { kind: "reorder", id: f.id, order: dirOrders[i] } }) }] : []),
    ]);

    if (path) expand(path);
    // Requests first: moving a Folder changes the paths under it.
    saveInBackground(
      new Map<Key, Move>([
        ...reqs.map((r, i) => ["r:" + r.id, { parentId: folderId, order: reqOrders[i] }] as const),
        // A Folder moved without a place keeps its order (FolderOp "move" carries none).
        ...dirs.map((f, i) => ["f:" + f.id, { parentId: folderId, order: dirAnchor ? dirOrders[i] : f.order }] as const),
      ]),
      [...reqMoves, ...dirMoves],
    );
  }

  function dragStart(e: React.DragEvent, key: Key) {
    e.stopPropagation();
    // WebKit only starts a drag that carries some data.
    e.dataTransfer.setData("text/plain", key);
    e.dataTransfer.effectAllowed = "move";
    if (picked.size > 1 && picked.has(key)) {
      setDrag([...picked]);
      // A "N items" chip under the pointer instead of the one row.
      const chip = document.createElement("div");
      chip.textContent = `${picked.size} items`;
      chip.className = "fixed top-0 left-0 rounded border border-z-primary bg-z-elevated px-2 py-1 text-xs text-z-text";
      document.body.appendChild(chip);
      e.dataTransfer.setDragImage(chip, -8, -8);
      setTimeout(() => chip.remove());
    } else {
      setPicked(new Set());
      setDrag([key]);
    }
  }

  function newRequest(name: string, parent: string) {
    const sibs = requestsIn(parent);
    const r: RequestItem = {
      id: crypto.randomUUID(), name, order: orderBetween(sibs.length ? sibs[sibs.length - 1].order : null, null),
      method: "GET", url: "", folder: parent, params: [], path_variables: [], headers: [], body: null, body_type: null, captures: [], scripts: { pre_request: "", post_response: "" }, path: "",
    };
    // Shown and opened at once, like a duplicate; the commit and push run in the background.
    onAdded(r);
    return createInBackground(r);
  }

  function newFolder(name: string, parent: string) {
    const sibs = foldersIn(parent);
    const f: FolderItem = {
      id: crypto.randomUUID(), name, path: parent ? `${parent}/${name}` : name, headers: [],
      order: orderBetween(sibs.length ? sibs[sibs.length - 1].order : null, null),
    };
    // Shown at once; the commit and push run in the background.
    setPending((l) => [...l, f]);
    const parentId = folderAt(parent)?.id ?? null;
    return saveInBackground(new Map(), [{ name, change: () => ({ kind: "folder", op: { kind: "create", id: f.id, name, parent_id: parentId, order: f.order } }) }]).finally(
      () => setPending((l) => l.filter((x) => x.id !== f.id)),
    );
  }

  function duplicate(r: RequestItem) {
    const next = requestsIn(r.folder).find((x) => x.order > r.order);
    const fresh = <T extends { id: string }>(l: T[]) => l.map((x) => ({ ...x, id: crypto.randomUUID() }));
    const copy: RequestItem = {
      ...r, id: crypto.randomUUID(), name: `${r.name} (copy)`, order: orderBetween(r.order, next?.order ?? null),
      params: fresh(r.params), path_variables: fresh(r.path_variables ?? []), headers: fresh(r.headers), captures: fresh(r.captures), path: "",
    };
    // Shown and opened at once; the commit and push run in the background.
    onAdded(copy);
    return createInBackground(copy);
  }

  function submit(name: string) {
    const e = editing;
    setEditing(null);
    if (!e || !name.trim()) return;
    name = name.trim();
    if (e.kind === "new-folder") return newFolder(name, e.parentPath);
    if (e.kind === "new-request") return newRequest(name, e.parentPath);
    // Renames show at once and save in the background, like drag and drop.
    const renamed = (id: string) => new Map<Key, Move>([["n:" + id, { name }]]);
    if (e.kind === "rename-folder")
      return saveInBackground(renamed(e.id), [{ name, change: () => ({ kind: "folder", op: { kind: "rename", id: e.id, name } }) }]);
    const r = collection.requests.find((x) => x.id === e.id);
    if (r)
      saveInBackground(renamed(r.id), [
        {
          name,
          change: () => {
            const base = baseOf(r);
            return { kind: "request", change: { kind: "update", base, ours: { ...base, name } }, folder_id: null };
          },
        },
      ]);
  }

  // Which part of the row the pointer is over decides the drop: the top / bottom edge of a Folder row puts
  // dragged Folders above / below it (the middle drops into it); a Request row is split in halves.
  function posOver(e: React.DragEvent, row: "request" | "folder", expanded = false): Pos {
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (row === "request") return y < 0.5 ? "before" : "after";
    if (!drag?.some((k) => k.startsWith("f:"))) return "into";
    // Below an open Folder is its first child, so the bottom edge drops into it.
    return y < 0.25 ? "before" : y > 0.75 && !expanded ? "after" : "into";
  }

  const endDrag = () => {
    setDrag(null);
    setTarget(null);
  };

  const dropProps = (key: Key, posFor: (e: React.DragEvent) => Pos, onDrop: (keys: Key[], pos: Pos) => void) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const pos = posFor(e);
      setTarget((t) => (t?.key === key && t.pos === pos ? t : { key, pos }));
    },
    onDragLeave: (e: React.DragEvent) => {
      // Leaving for a child of the row (icon, name) is not leaving the row.
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setTarget((t) => (t?.key === key ? null : t));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const keys = drag;
      const pos = posFor(e);
      endDrag();
      if (keys) onDrop(keys, pos);
    },
  });

  // The drop marker of a row: a line above / below it, or an outline when dropping into it.
  const dropMark = (key: Key) =>
    target?.key !== key
      ? undefined
      : target.pos === "into"
        ? "outline-1 -outline-offset-1 outline-z-primary outline-dashed"
        : cx(
            "after:pointer-events-none after:absolute after:right-1 after:left-[calc(8px+var(--depth,0)*var(--tree-indent))] after:h-0.5 after:rounded after:bg-z-primary after:content-['']",
            target.pos === "before" ? "after:-top-px" : "after:-bottom-px",
          );

  function nameInput(initial: string) {
    return (
      <Input
        size="small"
        className="flex-1"
        autoFocus
        defaultValue={initial}
        placeholder="Name"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit(e.currentTarget.value);
          if (e.key === "Escape") setEditing(null);
        }}
        onBlur={() => setEditing(null)}
      />
    );
  }

  // The name of a tree row. Saves run in the background (`saveInBackground`), so a row never shows a spinner.
  const itemName = (name: string) => <EllipsisText className={treeName} text={name} placement="right" />;

  const confirmDelete = (what: string, fn: () => void) =>
    modal.confirm({
      title: `Delete ${what}?`,
      content: "The deletion is shared with every Member of this Collection.",
      okText: "Delete",
      okButtonProps: { danger: true },
      // Not `onOk: fn`: Ant keeps the dialog open, spinning, while a returned promise (the push) runs.
      // The rows hide at once and the commit and push run in the background.
      onOk: () => {
        fn();
      },
    });

  // Right-click on a picked row acts on the whole multi-selection; on any other row it shows that row's menu.
  const withContextMenu = (key: Key, items: MenuProps["items"], row: React.ReactElement) => {
    const many = picked.size > 1 && picked.has(key);
    const menu: MenuProps["items"] = many
      ? [{ key: "del-many", icon: <LuTrash2 />, label: `Delete ${picked.size} items`, danger: true, onClick: deletePicked }]
      : items;
    return (
      <Dropdown
        key={key}
        menu={{ items: menu, onClick: (e) => e.domEvent.stopPropagation() }}
        trigger={["contextMenu"]}
        disabled={readOnly}
        onOpenChange={(o) => o && !many && picked.size && setPicked(new Set())}
      >
        {row}
      </Dropdown>
    );
  };

  const rowMenu = (items: MenuProps["items"]) => (
    <Dropdown menu={{ items, onClick: (e) => e.domEvent.stopPropagation() }} trigger={["click"]} disabled={readOnly}>
      <button className={rowMenuButton} aria-label="More actions" onClick={(e) => e.stopPropagation()}>
        <LuEllipsis />
      </button>
    </Dropdown>
  );

  // Tree level: 0 = the Collection row, 1 = items at the Collection root. The step is --tree-indent (WorkspaceSidebar).
  const indent = (level: number) => ({ "--depth": level }) as React.CSSProperties;

  function renderFolder(f: FolderItem) {
    if (!folderVisible(f)) return null;
    // Not saved yet: no menu, drag or drop until it exists in the Collection.
    if (isPending(f))
      return (
        <div key={f.id} role="treeitem" aria-busy>
          <div className={treeRow()} style={indent(depthOf(f.path))}>
            <span className={treeChevron}><LuChevronRight /></span>
            <span className={treeIcon}><LuFolder /></span>
            {itemName(f.name)}
          </div>
        </div>
      );
    const expanded = isOpen(f.path);
    const key = "f:" + f.id;
    const menu: MenuProps["items"] = [
      { key: "req", icon: <LuFilePlus />, label: "Add request", onClick: () => { expand(f.path); setEditing({ kind: "new-request", parentPath: f.path }); } },
      { key: "dir", icon: <LuFolderPlus />, label: "Add folder", onClick: () => { expand(f.path); setEditing({ kind: "new-folder", parentPath: f.path }); } },
      { key: "def", icon: <LuSlidersHorizontal />, label: "Headers & auth", onClick: () => onEditDefaults(f.path) },
      { type: "divider" },
      { key: "ren", icon: <LuPencil />, label: "Rename", onClick: () => setEditing({ kind: "rename-folder", id: f.id, name: f.name }) },
      {
        key: "del", icon: <LuTrash2 />, label: "Delete", danger: true,
        onClick: () => confirmDelete(`folder "${f.name}" and everything in it`, () => deleteInBackground([], [f])),
      },
    ];
    return (
      <div key={f.id} role="treeitem" aria-expanded={expanded} aria-selected={picked.has(key)}>
        {withContextMenu(key, menu, <div
          className={cx(treeRow({ picked: picked.has(key) }), dropMark(key))}
          style={indent(depthOf(f.path))}
          draggable={!readOnly}
          onDragStart={(e) => dragStart(e, key)}
          onDragEnd={endDrag}
          onClick={(e) => {
            if (pickClick(e, key)) return;
            setParentPath(f.path);
            setOpen((s) => { const n = new Set(s); n.has(f.path) ? n.delete(f.path) : n.add(f.path); return n; });
          }}
          {...dropProps(
            key,
            (e) => posOver(e, "folder", expanded),
            (keys, pos) => (pos === "into" ? place(keys, f.path) : place(keys, parentOf(f.path), { item: f, pos })),
          )}
        >
          <span className={treeChevron}>{expanded ? <LuChevronDown /> : <LuChevronRight />}</span>
          {/* The Folder new items go to is marked in the primary colour. */}
          <span className={parentPath === f.path ? "inline-flex flex-none text-z-primary" : treeIcon}>{expanded ? <LuFolderOpen /> : <LuFolder />}</span>
          {editing?.kind === "rename-folder" && editing.id === f.id ? nameInput(f.name) : itemName(f.name)}
          {rowMenu(menu)}
        </div>)}
        {expanded && renderLevel(f.path)}
      </div>
    );
  }

  function renderRequest(r: RequestItem) {
    if (!matches(r)) return null;
    const key = "r:" + r.id;
    const menu: MenuProps["items"] = [
      { key: "ren", icon: <LuPencil />, label: "Rename", onClick: () => setEditing({ kind: "rename-request", id: r.id, name: r.name }) },
      { key: "dup", icon: <LuCopy />, label: "Duplicate", onClick: () => duplicate(r) },
      { type: "divider" },
      { key: "del", icon: <LuTrash2 />, label: "Delete", danger: true, onClick: () => confirmDelete(`"${r.name}"`, () => deleteInBackground([r], [])) },
    ];
    return withContextMenu(key, menu,
      <div
        key={r.id}
        role="treeitem"
        aria-selected={picked.size ? picked.has(key) : selectedId === r.id}
        className={cx(treeRow({ active: selectedId === r.id, picked: picked.has(key) }), dropMark(key))}
        style={indent(depthOf(r.folder) + 1)}
        draggable={!readOnly}
        onDragStart={(e) => dragStart(e, key)}
        onDragEnd={endDrag}
        onClick={(e) => pickClick(e, key) || onSelect(r)}
        {...dropProps(key, (e) => posOver(e, "request"), (keys, pos) => place(keys, r.folder, { item: r, pos: pos === "after" ? "after" : "before" }))}
      >
        <span className={treeChevron} />
        <MethodTag method={requestTag(r)} compact />
        {editing?.kind === "rename-request" && editing.id === r.id ? (
          nameInput(r.name)
        ) : (
          itemName(r.name)
        )}
        {draftIds.has(r.id) && <span className={dirtyDot} aria-label="Unsaved changes" />}
        {rowMenu(menu)}
      </div>,
    );
  }

  function renderLevel(path: string) {
    const newHere = editing && (editing.kind === "new-folder" || editing.kind === "new-request") && editing.parentPath === path;
    return (
      <div role="group">
        {foldersIn(path).map(renderFolder)}
        {requestsIn(path).map(renderRequest)}
        {newHere && (
          <div className={treeRow()} style={indent(depthOf(path) + 1)}>
            <span className={treeChevron} />
            <span className={treeIcon}>{editing.kind === "new-folder" ? <LuFolder /> : <LuFilePlus />}</span>
            {nameInput("")}
          </div>
        )}
      </div>
    );
  }

  const empty = items.requests.length === 0 && folders.length === 0 && !editing;
  return (
    <div ref={treeEl} role="tree" aria-multiselectable className={cx("min-h-full", target?.key === "root" && "outline-1 outline-z-primary outline-dashed")} {...dropProps("root", () => "into", (keys) => place(keys, ""))}>
      {renderLevel("")}
      {empty && <p className={treeEmpty}>This Collection is empty. Add a request to get started.</p>}
    </div>
  );
});
