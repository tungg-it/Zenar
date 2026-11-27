import { useState } from "react";
import { Button, Input, Modal } from "antd";
import { LuChevronRight, LuFolder, LuListFilter, LuPackage } from "react-icons/lu";
import type { CollectionData } from "@/bindings/CollectionData";
import type { FolderItem } from "@/bindings/FolderItem";
import type { RequestItem } from "@/bindings/RequestItem";
import { EllipsisText, fieldLabel, MethodTag, requestTag, treeEmpty, treeIcon, treeName, treeRow } from "@/components/ui";
import { cx } from "@/libs/cx";

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const byOrder = (a: { order: number; name: string }, b: { order: number; name: string }) => a.order - b.order || a.name.localeCompare(b.name);
const crumb = (current: boolean) => cx("h-6 px-1 text-sm", current ? "font-semibold text-z-text" : "text-z-muted");

/**
 * Asked when a new tab is saved for the first time, like Postman's "Save request": its name, and
 * where it goes, picked by going down from the Collection one Folder at a time (or by searching).
 */
export function SaveRequestDialog({
  item,
  collection,
  onSave,
  onCancel,
}: {
  item: RequestItem;
  collection: CollectionData;
  onSave: (name: string, folder: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(item.name);
  // The Folder shown in the list, and where the Request is saved ("" = the Collection itself).
  const [at, setAt] = useState(item.folder);
  const [search, setSearch] = useState("");
  const ok = () => name.trim() && onSave(name.trim(), at);

  const subfolders = (path: string) => collection.folders.filter((f) => parentOf(f.path) === path).sort(byOrder);
  const q = search.trim().toLowerCase();
  const found = q ? collection.folders.filter((f) => f.path.toLowerCase().includes(q)).sort((a, b) => a.path.localeCompare(b.path)) : [];
  const folders = q ? found : subfolders(at);
  const requests = q ? [] : collection.requests.filter((r) => r.folder === at).sort(byOrder);
  const crumbs = at ? at.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/")) : [];
  const nameOf = (path: string) => collection.folders.find((f) => f.path === path)?.name ?? path.split("/").pop()!;
  const enter = (f: FolderItem) => {
    setAt(f.path);
    setSearch("");
  };

  return (
    <Modal
      open
      title="Save request"
      width={520}
      okText={at ? `Save to ${nameOf(at)}` : "Save"}
      okButtonProps={{ disabled: !name.trim() }}
      onOk={ok}
      onCancel={onCancel}
      destroyOnHidden
    >
      <label className={fieldLabel} htmlFor="save-request-name">
        Request name
      </label>
      <Input id="save-request-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} onPressEnter={ok} onFocus={(e) => e.target.select()} />

      <div className="mt-4 mb-1.5 flex min-w-0 flex-wrap items-center gap-0.5">
        <span className="mr-1 text-sm font-semibold">Save to</span>
        <Button type="text" size="small" className={crumb(!at)} onClick={() => setAt("")}>
          {collection.name}
        </Button>
        {crumbs.map((p) => (
          <span key={p} className="inline-flex items-center gap-0.5">
            <span className="text-z-faint">/</span>
            <Button type="text" size="small" className={crumb(p === at)} onClick={() => setAt(p)}>
              {nameOf(p)}
            </Button>
          </span>
        ))}
      </div>

      <div className="overflow-hidden rounded-md border border-z-border" style={{ "--tree-indent": "0px" } as React.CSSProperties}>
        <Input
          variant="borderless"
          prefix={<LuListFilter className="text-z-muted" />}
          placeholder="Search for folder"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          aria-label="Search for folder"
          className="border-b border-z-border"
        />
        <div className="h-72 overflow-auto p-1" role="list" aria-label="Folders">
          {folders.map((f) => {
            const deeper = subfolders(f.path).length > 0;
            return (
              <div
                key={f.id}
                role="button"
                tabIndex={0}
                className={treeRow()}
                onClick={() => enter(f)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), enter(f))}
              >
                <span className={treeIcon}>
                  <LuFolder />
                </span>
                <EllipsisText className={treeName} text={q ? f.path.split("/").join(" / ") : f.name} />
                <span className={cx(treeIcon, !deeper && "opacity-0 group-hover/row:opacity-100")}>
                  <LuChevronRight />
                </span>
              </div>
            );
          })}
          {requests.map((r) => (
            <div key={r.id} className={cx(treeRow({ clickable: false }), "pointer-events-none text-z-faint")} aria-disabled>
              <MethodTag method={requestTag(r)} />
              <EllipsisText className={treeName} text={r.name} />
            </div>
          ))}
          {!folders.length && !requests.length && (
            <p className={treeEmpty}>{q ? "No folder matches." : "This folder is empty. The Request will be the first one here."}</p>
          )}
        </div>
      </div>
      <p className="mt-1.5 mb-0 inline-flex items-center gap-1 text-sm text-z-muted">
        {at ? <LuFolder /> : <LuPackage />}
        Saved in {[collection.name, ...crumbs.map(nameOf)].join(" / ")}
      </p>
    </Modal>
  );
}
