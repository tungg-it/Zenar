import type { ReactNode } from "react";
import { cx } from "@/libs/cx";

/** Line of a Settings section; `stack` puts the control under the label instead of beside it. */
export const settingRow = (stack = false) =>
  cx("flex min-h-12 gap-6 border-b border-z-border py-2.5", stack ? "flex-col items-stretch gap-1.5" : "items-center justify-between");
export const settingLabel = "text-z-text";
/** Description under a label, or a lead paragraph of a section (with `my-2.5`). */
export const settingDesc = "text-sm leading-normal text-z-muted";

/** One Settings line, Postman-style: label and optional description on the left, the control on the right. */
export function SettingRow({ label, description, htmlFor, children }: { label: ReactNode; description?: ReactNode; htmlFor?: string; children?: ReactNode }) {
  return (
    <div className={settingRow()}>
      <div className="min-w-0">
        <label className={settingLabel} htmlFor={htmlFor}>
          {label}
        </label>
        {description && <div className={cx(settingDesc, "mt-0.5")}>{description}</div>}
      </div>
      {children && <div className="flex flex-none items-center">{children}</div>}
    </div>
  );
}

/** A titled group of Settings lines ("Request", "Tabs"). */
export function SettingSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="m-0 border-b border-z-border py-2.5 text-md font-semibold text-z-text">{title}</h3>
      {children}
    </section>
  );
}
