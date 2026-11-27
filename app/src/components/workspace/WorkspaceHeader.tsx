import { useState } from "react";
import { AutoComplete, Input } from "antd";
import { LuSearch, LuSettings, LuZap } from "react-icons/lu";
import type { CollectionData } from "@/bindings/CollectionData";
import type { RequestItem } from "@/bindings/RequestItem";
import { IconButton, MethodTag, requestTag, ThemeSwitcher } from "@/components/ui";
import { SHORTCUTS, hasAppMenu } from "@/libs/keys";
import type { MenuCommand } from "@/service/menu";
import { AppMenu } from "./AppMenu";
import { WindowControls } from "./WindowControls";

/** Top bar: brand and open Collection, Request search, theme and settings. */
export function WorkspaceHeader({
  collection,
  onPick,
  onOpenSettings,
  onCommand,
}: {
  collection: CollectionData | null;
  /** A Request chosen from the search box. */
  onPick: (r: RequestItem) => void;
  onOpenSettings: () => void;
  /** App command from the File / Edit / View / Help menu (Windows and Linux). */
  onCommand: (c: MenuCommand) => void;
}) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const options =
    collection && q
      ? collection.requests
          .filter((r) => (r.name + " " + r.url).toLowerCase().includes(q))
          .slice(0, 20)
          .map((r) => ({
            value: r.id,
            label: (
              <div className="flex items-center gap-2">
                <MethodTag method={requestTag(r)} compact />
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="text-sm text-z-faint">
                  {r.folder || collection.name}
                </span>
              </div>
            ),
          }))
      : [];

  return (
    <>
      {hasAppMenu && (
        // Title bar of the frameless window: empty space drags the window, double-click maximizes.
        <div data-tauri-drag-region className="flex h-8 flex-none items-center border-b border-z-border bg-z-header pl-1">
          <AppMenu onCommand={onCommand} />
          <div data-tauri-drag-region className="h-full min-w-0 flex-1" />
          <WindowControls />
        </div>
      )}
      <header
        className="grid h-11 flex-none grid-cols-[1fr_minmax(240px,520px)_1fr] items-center gap-3 border-b border-z-border bg-z-header px-2.5"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
              className="inline-flex items-center gap-1.5 font-semibold text-z-text"
            >
              <LuZap className="text-z-primary" aria-hidden /> Zenar
            </span>
          {collection && (
            <span className="truncate text-z-muted before:mr-2 before:text-z-faint before:content-['/']">
              {collection.name}
            </span>
          )}
        </div>
        <AutoComplete
          className="w-full"
          value={search}
          options={options}
          onSearch={setSearch}
          onSelect={(id: string) => {
            const r = collection?.requests.find((x) => x.id === id);
            if (r) onPick(r);
            setSearch("");
          }}
          disabled={!collection}
          popupMatchSelectWidth={480}
        >
          <Input
            id="request-search"
            prefix={<LuSearch />}
            placeholder={collection ? `Search ${collection.name}` : "Search"}
            aria-label="Search Requests"
            allowClear
          />
        </AutoComplete>
        <div
          className="flex min-w-0 items-center justify-end gap-2"
        >
          <ThemeSwitcher />
          <IconButton
            label={`Settings (${SHORTCUTS.settings})`}
            icon={<LuSettings />}
            onClick={onOpenSettings}
          />
        </div>
      </header>
    </>
  );
}
