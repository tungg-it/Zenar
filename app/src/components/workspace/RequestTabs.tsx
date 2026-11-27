import { useEffect, useRef, type ReactNode } from "react";
import { Dropdown, Select, type MenuProps } from "antd";
import { LuPlus, LuX } from "react-icons/lu";
import type { EnvironmentItem } from "@/bindings/EnvironmentItem";
import type { RequestItem } from "@/bindings/RequestItem";
import { dirtyDot, EllipsisText, IconButton, MethodTag, requestTag } from "@/components/ui";
import { cx } from "@/libs/cx";
import { SHORTCUTS } from "@/libs/keys";

const tab = (active: boolean) =>
  cx(
    "group/tab relative flex h-full max-w-[200px] flex-none cursor-pointer items-center gap-1.5 border-r border-z-border pr-1.5 pl-2.5",
    active
      ? "bg-z-bg text-z-text before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-z-primary before:content-['']"
      : "text-z-muted hover:bg-z-hover",
  );
const tabName = "truncate";
/** One slot at the end of a tab: the unsaved dot, swapped for the close button on hover or keyboard focus. */
const tabEnd =
  "group/end relative inline-flex size-[22px] flex-none items-center justify-center";
// Lucide's X fills only the middle half of its box: 20px draws a ~10px cross.
const tabClose =
  "absolute inset-0 inline-flex cursor-pointer items-center justify-center rounded-[3px] border-0 bg-transparent text-z-muted opacity-0 group-hover/tab:opacity-100 hover:bg-z-active hover:text-z-text focus-visible:opacity-100 [&>svg]:size-5";

/** A tab that is not a Request: Collection/Folder defaults, an Environment. */
export type OverviewTab = {
  key: string;
  title: string;
  icon: ReactNode;
  dirty?: boolean;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
};

/** Right-click menu actions on a Request tab. */
export type TabAction =
  | "new"
  | "duplicate"
  | "close"
  | "force-close"
  | "close-others"
  | "close-all"
  | "force-close-all";

/** Tab bar over the editor: the overview tab (Collection/Folder defaults or an Environment), open Requests, and the Environment picker. */
export function RequestTabs({
  tabs,
  activeId,
  isDirty,
  overviews,
  onActivate,
  onClose,
  onTabMenu,
  onNew,
  newDisabled,
  environments,
  envId,
  onEnvChange,
}: {
  tabs: RequestItem[];
  /** The Request shown in the editor (null while the overview tab is shown). */
  activeId: string | null;
  isDirty: (id: string) => boolean;
  /** Tabs that are not Requests (Collection/Folder defaults, an Environment), before the Request tabs. */
  overviews: OverviewTab[];
  onActivate: (r: RequestItem) => void;
  onClose: (id: string) => void;
  /** Right-click menu: `r` is the tab clicked. */
  onTabMenu: (action: TabAction, r: RequestItem) => void;
  /** Null hides the "+" button (no Collection open). */
  onNew: (() => void) | null;
  newDisabled: boolean;
  /** Null disables the picker (no Collection open). */
  environments: EnvironmentItem[] | null;
  envId: string | null;
  onEnvChange: (id: string | null) => void;
}) {
  // Same entries and order as Postman's tab menu; "force" closes without asking about unsaved changes.
  const menuFor = (r: RequestItem): MenuProps => ({
    items: [
      {
        key: "new",
        label: "New Request",
        extra: SHORTCUTS.newRequest,
        disabled: !onNew || newDisabled,
      },
      { key: "duplicate", label: "Duplicate Tab", disabled: newDisabled },
      { type: "divider" },
      { key: "close", label: "Close Tab", extra: SHORTCUTS.closeTab },
      {
        key: "force-close",
        label: "Force Close Tab",
        extra: SHORTCUTS.forceCloseTab,
      },
      {
        key: "close-others",
        label: "Close Other Tabs",
        disabled: tabs.length < 2,
      },
      { key: "close-all", label: "Close All Tabs" },
      { key: "force-close-all", label: "Force Close All Tabs" },
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      onTabMenu(key as TabAction, r);
    },
  });

  // Keep the tab in front visible: a newly opened tab lands at the end, past the right edge.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length, overviews.find((o) => o.active)?.key]);

  return (
    <div
      className="flex h-[38px] flex-none items-stretch border-b border-z-border"
      role="tablist"
      aria-label="Open Requests"
    >
      <div
        ref={strip}
        className="flex min-w-0 flex-[0_1_auto] items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        // The scrollbar is hidden: a plain mouse wheel scrolls the tabs sideways.
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX))
            e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        {overviews.map((o) => (
          <div
            key={o.key}
            className={tab(o.active)}
            role="tab"
            aria-selected={o.active}
            onClick={() => !o.active && o.onActivate()}
            onAuxClick={(e) => e.button === 1 && o.onClose()}
          >
            <span className="inline-flex flex-none text-z-muted">{o.icon}</span>
            <EllipsisText
              className={tabName}
              text={o.title}
              placement="bottom"
            />
            <span className={tabEnd}>
              {o.dirty && (
                <span
                  className={cx(
                    dirtyDot,
                    "group-hover/tab:invisible group-focus-within/end:invisible",
                  )}
                  aria-label="Unsaved changes"
                />
              )}
              <button
                className={tabClose}
                aria-label={`Close ${o.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  o.onClose();
                }}
              >
                <LuX />
              </button>
            </span>
          </div>
        ))}
        {tabs.map((r) => {
          const active = !overviews.some((o) => o.active) && activeId === r.id;
          return (
            <Dropdown
              key={r.id}
              menu={menuFor(r)}
              trigger={["contextMenu"]}
              classNames={{
                root: "[&_.ant-dropdown-menu]:min-w-[220px] [&_.ant-dropdown-menu-item-extra]:text-z-faint",
              }}
            >
              <div
                role="tab"
                aria-selected={active}
                className={tab(active)}
                onClick={() => !active && onActivate(r)}
                onAuxClick={(e) => e.button === 1 && onClose(r.id)}
              >
                <MethodTag method={requestTag(r)} compact />
                <EllipsisText
                  className={tabName}
                  text={r.name}
                  placement="bottom"
                />
                <span className={tabEnd}>
                  {isDirty(r.id) && (
                    <span
                      className={cx(
                        dirtyDot,
                        "group-hover/tab:invisible group-focus-within/end:invisible",
                      )}
                      aria-label="Unsaved changes"
                    />
                  )}
                  <button
                    className={tabClose}
                    aria-label={`Close ${r.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose(r.id);
                    }}
                  >
                    <LuX />
                  </button>
                </span>
              </div>
            </Dropdown>
          );
        })}
      </div>
      {onNew && (
        <IconButton
          label="New Request"
          icon={<LuPlus />}
          disabled={newDisabled}
          onClick={onNew}
          className="mx-1 my-auto"
        />
      )}
      <Select
        className="mr-1 ml-auto w-[180px] flex-none self-center border-l border-z-border"
        value={envId ?? ""}
        onChange={(v) => onEnvChange(v || null)}
        disabled={!environments}
        variant="borderless"
        popupMatchSelectWidth={false}
        aria-label="Environment"
        options={[
          { value: "", label: "No environment" },
          ...(environments ?? []).map((e) => ({ value: e.id, label: e.name })),
        ]}
      />
    </div>
  );
}
