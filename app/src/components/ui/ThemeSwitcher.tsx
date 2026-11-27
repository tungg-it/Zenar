import { Button, Dropdown } from "antd";
import { LuCheck, LuMonitor, LuMoon, LuSun } from "react-icons/lu";
import { useTheme } from "@/components/providers";
import type { ThemeMode } from "@/libs/theme";
import { iconButtonClass } from "./IconButton";

const MODES: { key: ThemeMode; label: string; icon: JSX.Element }[] = [
  { key: "light", label: "Light", icon: <LuSun /> },
  { key: "dark", label: "Dark", icon: <LuMoon /> },
  { key: "system", label: "System", icon: <LuMonitor /> },
];

/** Topbar button: pick Light, Dark or System. */
export function ThemeSwitcher() {
  const { mode, resolved, setMode } = useTheme();
  const icon = mode === "system" ? <LuMonitor /> : resolved === "dark" ? <LuMoon /> : <LuSun />;
  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        selectedKeys: [mode],
        items: MODES.map((t) => ({
          key: t.key,
          icon: t.icon,
          label: (
            <span className="inline-flex items-center gap-2">
              {t.label} {mode === t.key && <LuCheck />}
            </span>
          ),
          onClick: () => setMode(t.key),
        })),
      }}
    >
      <Button type="text" size="small" className={iconButtonClass()} aria-label="Theme" icon={icon} />
    </Dropdown>
  );
}
