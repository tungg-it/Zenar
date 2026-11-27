import type { ReactNode } from "react";
import { LuCodeXml, LuVariable } from "react-icons/lu";
import { IconButton } from "@/components/ui";

export type RightView = "variables" | "code";

const RAIL: { key: RightView; label: string; icon: JSX.Element }[] = [
  { key: "variables", label: "Variables", icon: <LuVariable /> },
  { key: "code", label: "Code snippet", icon: <LuCodeXml /> },
];

/** Right sidebar (Postman's context bar): the view switcher rail on top, the chosen view below. Shown / hidden from the status bar, like the left one. */
export function RightSidebar({ view, onViewChange, children }: { view: RightView; onViewChange: (v: RightView) => void; children: ReactNode }) {
  return (
    <aside className="flex w-[var(--right-w,380px)] max-w-[45vw] min-h-0 flex-none flex-col border-l border-z-border bg-z-sidebar" aria-label="Request details">
      <nav className="flex h-[38px] flex-none items-center justify-center gap-3 border-b border-z-border px-2" aria-label="Request details views">
        {RAIL.map((r) => (
          <IconButton key={r.key} label={r.label} icon={r.icon} active={view === r.key} onClick={() => onViewChange(r.key)} />
        ))}
      </nav>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
    </aside>
  );
}
