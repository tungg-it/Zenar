import type { ReactNode } from "react";
import { Button, Tooltip } from "antd";
import { cx } from "@/libs/cx";

/** Classes of an icon-only text button; also used where Ant renders the button (ThemeSwitcher's Dropdown). */
export const iconButtonClass = ({ active = false, compact = false, danger = false } = {}) =>
  cx(
    compact ? "size-6" : "size-7",
    !danger && (active ? "enabled:bg-z-active enabled:text-z-text" : "enabled:text-z-muted enabled:hover:bg-z-active enabled:hover:text-z-text"),
  );

/** Icon-only button: always has a tooltip and an accessible label. `compact` is the status bar size. */
export function IconButton({
  label,
  icon,
  onClick,
  disabled,
  loading,
  active,
  danger,
  compact,
  className,
}: {
  label: string;
  icon: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  /** Ant's spinner in place of the icon, while an action it started waits on git or the network. */
  loading?: boolean;
  active?: boolean;
  danger?: boolean;
  compact?: boolean;
  className?: string;
}) {
  return (
    <Tooltip title={label} mouseEnterDelay={0.4}>
      <Button
        type="text"
        size="small"
        aria-label={label}
        className={cx(iconButtonClass({ active, compact, danger }), className)}
        icon={icon}
        onClick={onClick}
        disabled={disabled}
        loading={loading}
        danger={danger}
      />
    </Tooltip>
  );
}
