import type { ReactNode } from "react";

/** Uppercase section title in the sidebar ("COLLECTIONS", "ENVIRONMENTS"). */
export function SectionTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-2 pt-2.5 pb-1 text-xs font-semibold tracking-[0.06em] text-z-muted uppercase">
      <span>{children}</span>
      {extra && <span>{extra}</span>}
    </div>
  );
}
