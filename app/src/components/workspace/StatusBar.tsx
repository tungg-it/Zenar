import { Tooltip } from "antd";
import { LuCloud, LuCloudOff, LuLayers, LuPanelLeft, LuPanelRight, LuSettings } from "react-icons/lu";
import { IconButton } from "@/components/ui";
import { cx } from "@/libs/cx";

const item = "inline-flex items-center gap-[5px]";

/** Bottom bar: sidebar toggles, sync state, queued Saves, active Environment, settings. */
export function StatusBar({
  sidebarOpen,
  onToggleSidebar,
  rightOpen,
  onToggleRight,
  syncing,
  syncFailure,
  queued,
  envName,
  onOpenSettings,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  rightOpen: boolean;
  /** Null when there is nothing to show on the right (no Request open). */
  onToggleRight: (() => void) | null;
  /** A Collection is open, so background sync runs. */
  syncing: boolean;
  syncFailure: string | null;
  queued: number;
  envName: string | null;
  onOpenSettings: () => void;
}) {
  return (
    <footer className="flex h-7 flex-none items-center justify-between border-t border-z-border bg-z-header px-1.5 text-sm text-z-muted">
      <div className="flex items-center gap-2.5">
        <IconButton label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} icon={<LuPanelLeft />} onClick={onToggleSidebar} compact />
        {syncing && (
          <Tooltip title={syncFailure ? `Sync paused: ${syncFailure}` : "Checking for teammates' Saves every minute"}>
            <span className={cx(item, syncFailure && "text-z-post")}>
              {syncFailure ? <LuCloudOff /> : <LuCloud />} {syncFailure ? "Sync paused" : "Synced"}
            </span>
          </Tooltip>
        )}
        {queued > 0 && <span className={cx(item, "text-z-post")}>{queued} Save(s) waiting for a connection</span>}
      </div>
      <div className="flex items-center gap-2.5">
        {envName && (
          <span className={item}>
            <LuLayers /> {envName}
          </span>
        )}
        <button className="inline-flex cursor-pointer items-center gap-[5px] rounded border-0 bg-transparent px-1.5 py-0.5 font-[inherit] text-inherit hover:bg-z-hover hover:text-z-text" onClick={onOpenSettings}>
          <LuSettings /> Settings
        </button>
        <IconButton
          label={rightOpen ? "Hide right sidebar" : "Show right sidebar"}
          icon={<LuPanelRight />}
          onClick={onToggleRight ?? undefined}
          disabled={!onToggleRight}
          compact
        />
      </div>
    </footer>
  );
}
