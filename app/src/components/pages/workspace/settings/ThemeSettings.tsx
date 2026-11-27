import type { CSSProperties } from "react";
import { Button, Radio } from "antd";
import { LuZoomIn, LuZoomOut } from "react-icons/lu";
import { useTheme } from "@/components/providers";
import type { useZoom } from "@/hooks";
import { previewVars, type ResolvedTheme, type ThemeMode } from "@/libs/theme";
import { SettingRow, SettingSection } from "./SettingRow";
import { cx } from "@/libs/cx";

const bar = "h-1.5 rounded-[3px]";
/** Outline of a card's preview; the chosen mode is drawn in the primary colour. */
const frame = (selected: boolean) =>
  cx("rounded-md transition-[outline-color] duration-150", selected ? "outline-2 outline-offset-2 outline-z-primary" : "outline-1 outline-z-border-strong");

const MODES: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Sync with OS" },
];

/** A tiny drawing of the app (header, sidebar, rows) in one mode's colours; `className` adds the card frame. */
function Preview({ mode, className }: { mode: ResolvedTheme; className?: string }) {
  return (
    <span className={cx("grid h-24 grid-cols-[28%_1fr] grid-rows-[14px_1fr] overflow-hidden bg-p-bg", className)} style={previewVars(mode) as CSSProperties} aria-hidden>
      <span className="col-span-full border-b border-p-border bg-p-header" />
      <span className="border-e border-p-border bg-p-sidebar" />
      <span className="flex flex-col gap-1.5 p-2.5">
        <span className={cx(bar, "w-2/5 bg-p-primary")} />
        <span className={cx(bar, "bg-p-text opacity-50")} />
        <span className={cx(bar, "w-3/5 bg-p-text opacity-50")} />
      </span>
    </span>
  );
}

/** Settings → Themes: Light / Dark / Sync with OS and interface zoom, both per machine. */
export function ThemeSettings({ zoom }: { zoom: ReturnType<typeof useZoom> }) {
  const { mode, setMode } = useTheme();
  return (
    <>
      <SettingSection title="Theme">
        <Radio.Group className="grid w-full grid-cols-3 gap-4 pt-3.5" value={mode} onChange={(e) => setMode(e.target.value)}>
          {MODES.map((m) => (
            <label key={m.value} className="flex cursor-pointer flex-col gap-2">
              {m.value === "system" ? (
                <span className={cx(frame(mode === m.value), "grid grid-cols-2 overflow-hidden")}>
                  <Preview mode="light" />
                  <Preview mode="dark" />
                </span>
              ) : (
                <Preview mode={m.value} className={frame(mode === m.value)} />
              )}
              <Radio value={m.value}>{m.label}</Radio>
            </label>
          ))}
        </Radio.Group>
      </SettingSection>
      <SettingSection title="Interface">
        <SettingRow label="Zoom" description="Size of the whole interface on this machine.">
          <div className="flex items-center gap-2">
            <Button size="small" icon={<LuZoomOut />} aria-label="Zoom out" onClick={zoom.zoomOut} />
            <span className="min-w-11 text-center tabular-nums">{Math.round(zoom.zoom * 100)}%</span>
            <Button size="small" icon={<LuZoomIn />} aria-label="Zoom in" onClick={zoom.zoomIn} />
            <Button size="small" onClick={zoom.resetZoom} disabled={zoom.zoom === 1}>
              Reset
            </Button>
          </div>
        </SettingRow>
      </SettingSection>
    </>
  );
}
