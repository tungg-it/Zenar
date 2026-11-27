import type { ReactNode } from "react";
import { LuHistory, LuLayers, LuPackage } from "react-icons/lu";
import { IconButton } from "@/components/ui";

export type SidebarView = "collections" | "environments" | "history";

const RAIL: { key: SidebarView; label: string; icon: JSX.Element }[] = [
  { key: "collections", label: "Collections", icon: <LuPackage /> },
  { key: "environments", label: "Environments", icon: <LuLayers /> },
  { key: "history", label: "History", icon: <LuHistory /> },
];

/** Left sidebar: the view switcher rail on top, the chosen view below. */
export function WorkspaceSidebar({ view, onViewChange, children }: { view: SidebarView; onViewChange: (v: SidebarView) => void; children: ReactNode }) {
  return (
    // --tree-indent: one step per tree level (Collection > Folder > sub-Folder / Request), see `treeRow`.
    <aside className="flex w-[var(--sidebar-w,320px)] max-w-[45vw] min-h-0 flex-none flex-col border-r border-z-border bg-z-sidebar [--tree-indent:12px]" aria-label="Sidebar">
      <nav className="flex h-[38px] flex-none items-center justify-center gap-3 border-b border-z-border px-2" aria-label="Sidebar views">
        {RAIL.map((r) => (
          <IconButton key={r.key} label={r.label} icon={r.icon} active={view === r.key} onClick={() => onViewChange(r.key)} />
        ))}
      </nav>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </aside>
  );
}
