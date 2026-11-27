import { useState, type ReactNode } from "react";
import { Dropdown, Input, type MenuProps } from "antd";
import { LuArrowRightLeft, LuFolderPlus, LuGitBranch, LuLayers } from "react-icons/lu";
import { SiGraphql } from "react-icons/si";
import { SHORTCUTS } from "@/libs/keys";

export type NewKind = "request" | "graphql" | "folder" | "environment" | "collection";

type Entry = { key: NewKind; icon: ReactNode; label: string; extra?: string; needsCollection: boolean };

// Like Postman's "+" menu: request types first (coloured icons), then the things that hold them (plain icons).
const GROUPS: Entry[][] = [
  [
    { key: "request", icon: <LuArrowRightLeft className="text-z-get" />, label: "HTTP", extra: SHORTCUTS.newRequest, needsCollection: true },
    { key: "graphql", icon: <SiGraphql className="text-z-graphql" />, label: "GraphQL", needsCollection: true },
  ],
  [
    { key: "folder", icon: <LuFolderPlus className="text-z-muted" />, label: "Folder", needsCollection: true },
    { key: "collection", icon: <LuGitBranch className="text-z-muted" />, label: "Collection", needsCollection: false },
    { key: "environment", icon: <LuLayers className="text-z-muted" />, label: "Environment", needsCollection: true },
  ],
];

/** Postman's "New" dropdown: a search box over grouped entries; Enter picks the first match. */
export function NewMenu({
  canEdit,
  onPick,
  children,
}: {
  /** A writable Collection is open: everything but a new Collection needs one. */
  canEdit: boolean;
  onPick: (kind: NewKind) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const groups = GROUPS.map((g) => g.filter((e) => !q || e.label.toLowerCase().includes(q))).filter((g) => g.length);
  const enabled = (e: Entry) => canEdit || !e.needsCollection;

  const items: MenuProps["items"] = groups.flatMap((g, i) => [
    ...(i ? [{ type: "divider" as const }] : []),
    ...g.map((e) => ({ key: e.key, icon: e.icon, label: e.label, extra: e.extra, disabled: !enabled(e) })),
  ]);

  function pick(kind: NewKind) {
    setOpen(false);
    setQuery("");
    onPick(kind);
  }

  return (
    <Dropdown
      trigger={["click"]}
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
      menu={{ items, onClick: ({ key }) => pick(key as NewKind) }}
      popupRender={(menu) => (
        <div className="w-[220px] rounded-lg bg-z-elevated p-1 shadow-lg ring-1 ring-z-border [&_.ant-dropdown-menu]:bg-transparent! [&_.ant-dropdown-menu]:p-0! [&_.ant-dropdown-menu]:shadow-none!">
          <Input
            size="small"
            placeholder="Search..."
            aria-label="Search what to create"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const first = groups.flat().find(enabled);
              if (first) pick(first.key);
            }}
            className="mb-1"
          />
          {items.length ? menu : <div className="px-2 py-1.5 text-z-muted">No matches</div>}
        </div>
      )}
    >
      {children}
    </Dropdown>
  );
}
