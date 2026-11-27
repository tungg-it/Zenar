import { useRef, useState } from "react";
import { Alert, App as AntApp, Dropdown, Input, type MenuProps } from "antd";
import { LuCopy, LuDownload, LuEllipsis, LuLayers, LuPencil, LuTrash2 } from "react-icons/lu";
import { exportEnvironment } from "@/service/environment";
import { pickSavePath } from "@/service/files";
import type { CollectionData } from "@/bindings/CollectionData";
import type { EnvironmentItem } from "@/bindings/EnvironmentItem";
import {
  rowMenuButton,
  sidebarAlert,
  treeEmpty,
  treeIcon,
  treeName,
  treeRow,
} from "@/components/ui";
import { cx } from "@/libs/cx";
import { orderBetween } from "@/libs/order";

type Props = {
  root: string;
  collection: CollectionData;
  /** The active Environment (local choice, remembered on this machine). */
  envId: string | null;
  /** The Environment open in a tab, highlighted in the list. */
  openId: string | null;
  /** Open an Environment's variables in a tab; null starts a new one. */
  onOpen: (e: EnvironmentItem | null) => void;
  /** Delete for every Member, then reload the Collection. */
  onDelete: (e: EnvironmentItem) => Promise<void>;
  /** Share a new name (Rename) or `order` (drag and drop), then reload the Collection. */
  onUpdate: (e: EnvironmentItem, patch: EnvPatch) => Promise<void>;
  /** Share `copy` of `e` as a new Environment, reload the Collection and open the copy. */
  onDuplicate: (e: EnvironmentItem, copy: EnvironmentItem) => Promise<void>;
  readOnly?: boolean;
};

type Pos = "before" | "after";
export type EnvPatch = Partial<Pick<EnvironmentItem, "name" | "order">>;

/**
 * Sidebar Environments view: the shared Environments (Secret values are filled in each Environment's tab).
 * Rename, Duplicate, Delete ("…" or right-click) and drag and drop show at once and save in the background,
 * one after another.
 */
export function EnvironmentsPanel({
  root,
  collection,
  envId,
  openId,
  onOpen,
  onDelete,
  onUpdate,
  onDuplicate,
  readOnly = false,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const { message, modal } = AntApp.useApp();
  // Changes still saving, shown over the loaded Collection until its reload has them.
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Map<string, EnvPatch>>(new Map());
  // Copies not saved yet: shown, but no menu, drag or drop until they exist in the Collection.
  const [added, setAdded] = useState<EnvironmentItem[]>([]);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const [dragId, setDragId] = useState<string | null>(null);
  const [target, setTarget] = useState<{ id: string; pos: Pos } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const isAdded = (id: string) => added.some((a) => a.id === id);
  const shown = [
    ...collection.environments.filter((e) => !gone.has(e.id)).map((e) => ({ ...e, ...edits.get(e.id) })),
    ...added.filter((a) => !collection.environments.some((e) => e.id === a.id)),
  ].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  // One save at a time; `done` drops its overlay once the Collection is reloaded (or the save failed).
  function inBackground(run: () => Promise<void>, done: () => void) {
    saving.current = saving.current
      .then(run)
      .catch((e) => setError(String(e)))
      .finally(done);
  }

  function remove(e: EnvironmentItem) {
    modal.confirm({
      title: `Delete Environment "${e.name}"?`,
      content: "The deletion is shared with every Member of this Collection. Your Secret values for it on this machine are deleted too.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: () => {
        setGone((s) => new Set(s).add(e.id));
        inBackground(
          () => onDelete(e),
          () => setGone((s) => { const n = new Set(s); n.delete(e.id); return n; }),
        );
      },
    });
  }

  // `e` as loaded (the base of the merge), `patch` shown at once.
  function update(e: EnvironmentItem, patch: EnvPatch) {
    setEdits((m) => new Map(m).set(e.id, { ...m.get(e.id), ...patch }));
    inBackground(
      () => onUpdate(e, patch),
      () => setEdits((m) => { const n = new Map(m); n.delete(e.id); return n; }),
    );
  }

  function rename(e: EnvironmentItem, name: string) {
    setRenaming(null);
    name = name.trim();
    if (name && name !== (edits.get(e.id)?.name ?? e.name)) update(e, { name });
  }

  // The copy goes right after the original, like a duplicated Request.
  function duplicate(e: EnvironmentItem) {
    const i = shown.findIndex((x) => x.id === e.id);
    const copy: EnvironmentItem = {
      ...e,
      ...edits.get(e.id),
      id: crypto.randomUUID(),
      name: `${edits.get(e.id)?.name ?? e.name} (copy)`,
      order: orderBetween(shown[i].order, shown[i + 1]?.order ?? null),
      variables: e.variables.map((v) => ({ ...v })),
      path: "",
    };
    setAdded((a) => [...a, copy]);
    inBackground(
      () => onDuplicate(e, copy),
      () => setAdded((a) => a.filter((x) => x.id !== copy.id)),
    );
  }

  function drop(id: string, over: string, pos: Pos) {
    const rest = shown.filter((e) => e.id !== id);
    const moved = collection.environments.find((e) => e.id === id);
    const i = rest.findIndex((e) => e.id === over);
    if (!moved || i < 0) return;
    const at = pos === "after" ? i + 1 : i;
    const [prev, next] = [rest[at - 1], rest[at]];
    // Dropped where it already is.
    if (shown.findIndex((e) => e.id === id) === at) return;
    const order = orderBetween(prev?.order ?? null, next?.order ?? null);
    update(moved, { order });
  }

  const endDrag = () => {
    setDragId(null);
    setTarget(null);
  };

  // A row is split in halves: the top drops the dragged Environment above it, the bottom below.
  const dropProps = (id: string) => ({
    onDragOver: (ev: React.DragEvent) => {
      if (!dragId || isAdded(id)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      const r = ev.currentTarget.getBoundingClientRect();
      const pos: Pos = ev.clientY - r.top < r.height / 2 ? "before" : "after";
      setTarget((t) => (t?.id === id && t.pos === pos ? t : { id, pos }));
    },
    onDragLeave: (ev: React.DragEvent) => {
      if (ev.currentTarget.contains(ev.relatedTarget as Node | null)) return;
      setTarget((t) => (t?.id === id ? null : t));
    },
    onDrop: (ev: React.DragEvent) => {
      if (!dragId) return;
      ev.preventDefault();
      const pos = target?.id === id ? target.pos : "before";
      const moved = dragId;
      endDrag();
      drop(moved, id, pos);
    },
  });

  // The drop line above / below a row, like the Collection tree's.
  const dropMark = (id: string) =>
    target?.id === id &&
    target.id !== dragId &&
    cx(
      "after:pointer-events-none after:absolute after:right-1 after:left-2 after:h-0.5 after:rounded after:bg-z-primary after:content-['']",
      target.pos === "before" ? "after:-top-px" : "after:-bottom-px",
    );

  // The file carries this person's Secret values: that is how a Member hands them to another.
  async function exportEnv(e: EnvironmentItem) {
    try {
      const path = await pickSavePath("Export Environment", `${e.name}.postman_environment.json`);
      if (!path) return;
      await exportEnvironment(root, e.id, path);
      message.warning(`Exported "${e.name}". The file contains Secret values: don't commit it or share it publicly.`, 8);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div>
      {error && (
        <Alert
          type="error"
          title={error}
          closable={{ onClose: () => setError(null) }}
          className={sidebarAlert}
        />
      )}
      {shown.map((e) => {
        // Actions start from the Environment as loaded; `e` also shows the changes still saving.
        const loaded = collection.environments.find((x) => x.id === e.id);
        if (!loaded)
          return (
            <div key={e.id} className={treeRow({ clickable: false })}>
              <span className={treeIcon}>
                <LuLayers />
              </span>
              <span className={treeName}>{e.name}</span>
            </div>
          );
        const menu: MenuProps["items"] = [
          ...(readOnly
            ? []
            : [
                { key: "ren", icon: <LuPencil />, label: "Rename", onClick: () => setRenaming(e.id) },
                { key: "dup", icon: <LuCopy />, label: "Duplicate", onClick: () => duplicate(loaded) },
              ]),
          { key: "export", icon: <LuDownload />, label: "Export", onClick: () => void exportEnv(loaded) },
          ...(readOnly
            ? []
            : [
                { type: "divider" as const },
                { key: "del", icon: <LuTrash2 />, label: "Delete", danger: true, onClick: () => remove(loaded) },
              ]),
        ];
        return (
          // Clicking shows the Environment's variables; the active one is picked in the tab bar's Environment menu.
          <Dropdown key={e.id} menu={{ items: menu, onClick: ({ domEvent }) => domEvent.stopPropagation() }} trigger={["contextMenu"]}>
            <div
              role="button"
              tabIndex={0}
              className={cx(treeRow({ active: openId === e.id }), dragId === e.id && "opacity-50", dropMark(e.id))}
              draggable={!readOnly && renaming !== e.id}
              onDragStart={(ev) => {
                // WebKit only starts a drag that carries some data.
                ev.dataTransfer.setData("text/plain", e.id);
                ev.dataTransfer.effectAllowed = "move";
                setDragId(e.id);
              }}
              onDragEnd={endDrag}
              {...dropProps(e.id)}
              onClick={() => onOpen(loaded)}
              onKeyDown={(ev) => ev.key === "Enter" && onOpen(loaded)}
            >
              <span className={treeIcon}>
                <LuLayers />
              </span>
              {renaming === e.id ? (
                // Enter keeps the name, Esc or leaving the field cancels, like the Collection tree.
                <Input
                  size="small"
                  className="flex-1"
                  autoFocus
                  defaultValue={e.name}
                  placeholder="Name"
                  onClick={(ev) => ev.stopPropagation()}
                  onKeyDown={(ev) => {
                    ev.stopPropagation();
                    if (ev.key === "Enter") rename(loaded, ev.currentTarget.value);
                    if (ev.key === "Escape") setRenaming(null);
                  }}
                  onBlur={() => setRenaming(null)}
                />
              ) : (
                <span className={treeName}>{e.name}</span>
              )}
              {envId === e.id && (
                <span className="rounded-lg bg-z-active px-1.5 text-2xs text-z-muted">
                  active
                </span>
              )}
              <Dropdown trigger={["click"]} menu={{ items: menu, onClick: ({ domEvent }) => domEvent.stopPropagation() }}>
                <button
                  className={rowMenuButton}
                  aria-label={`More actions for ${e.name}`}
                  onClick={(ev) => ev.stopPropagation()}
                  onKeyDown={(ev) => ev.stopPropagation()}
                >
                  <LuEllipsis />
                </button>
              </Dropdown>
            </div>
          </Dropdown>
        );
      })}
      {collection.environments.length === 0 && (
        <p className={treeEmpty}>
          No Environments yet. Create one to hold base URLs and Secrets.
        </p>
      )}
    </div>
  );
}
