import type { ComponentProps } from "react";
import { Menu, Modal } from "antd";
import { LuKeyboard, LuPalette, LuSettings } from "react-icons/lu";
import type { useZoom } from "@/hooks";
import { GeneralSettings } from "./GeneralSettings";
import { ShortcutList } from "./ShortcutList";
import { ThemeSettings } from "./ThemeSettings";
import { cx } from "@/libs/cx";

export type SettingsSection = "general" | "themes" | "shortcuts";

const SECTIONS: { key: SettingsSection; icon: JSX.Element; label: string }[] = [
  { key: "general", icon: <LuSettings />, label: "General" },
  { key: "themes", icon: <LuPalette />, label: "Themes" },
  { key: "shortcuts", icon: <LuKeyboard />, label: "Shortcuts" },
];

// Postman's section menu: compact items, muted until hovered or selected. Ant sets the item padding inline, hence `!`.
const navMenu = cx(
  "border-e-0! bg-transparent",
  "[&_.ant-menu-item]:my-px [&_.ant-menu-item]:h-[30px] [&_.ant-menu-item]:w-full [&_.ant-menu-item]:px-2.5! [&_.ant-menu-item]:leading-[30px] [&_.ant-menu-item]:text-z-muted",
  "[&_.ant-menu-item:hover]:bg-z-hover! [&_.ant-menu-item:hover]:text-z-text",
  "[&_.ant-menu-item-selected]:bg-z-active! [&_.ant-menu-item-selected]:font-medium [&_.ant-menu-item-selected]:text-z-text",
);

/**
 * Settings popup (this machine only), laid out like Postman's: a section menu on the left, the
 * section's title and lines on the right. `section` null = closed.
 */
export function SettingsModal({
  section,
  onSection,
  onClose,
  zoom,
  ...general
}: {
  section: SettingsSection | null;
  onSection: (s: SettingsSection) => void;
  onClose: () => void;
  zoom: ReturnType<typeof useZoom>;
} & ComponentProps<typeof GeneralSettings>) {
  const current = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0];
  return (
    <Modal
      open={section !== null}
      onCancel={onClose}
      footer={null}
      width={920}
      centered
      classNames={{ container: "overflow-hidden bg-z-bg p-0", close: "end-[18px] top-[18px]" }}
      aria-label="Settings"
    >
      <div className="flex h-[min(720px,84vh)]">
        <nav className="w-[220px] flex-none overflow-y-auto border-e border-z-border bg-z-sidebar px-2.5 py-4">
          <Menu
            mode="inline"
            className={navMenu}
            selectedKeys={[current.key]}
            items={SECTIONS}
            onClick={({ key }) => onSection(key as SettingsSection)}
          />
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto px-6 pt-[18px] pb-6">
          <h2 className="mt-0 mb-3 text-lg font-semibold text-z-text">{current.label}</h2>
          {current.key === "general" && <GeneralSettings {...general} />}
          {current.key === "themes" && <ThemeSettings zoom={zoom} />}
          {current.key === "shortcuts" && <ShortcutList />}
        </div>
      </div>
    </Modal>
  );
}
