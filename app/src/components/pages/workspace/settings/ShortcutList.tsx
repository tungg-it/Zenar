import { keyCaps, SHORTCUTS } from "@/libs/keys";
import { SettingRow, SettingSection } from "./SettingRow";

type Key = keyof typeof SHORTCUTS;

// Grouped like Postman's Shortcuts page.
const GROUPS: { title: string; items: [label: string, key: Key][] }[] = [
  {
    title: "Tabs",
    items: [
      ["New Request", "newRequest"],
      ["Reopen last closed tab", "reopenTab"],
      ["Close tab", "closeTab"],
      ["Force close tab", "forceCloseTab"],
      ["Switch to next tab", "nextTab"],
      ["Switch to previous tab", "prevTab"],
      ["Switch to tab at position", "gotoTab"],
      ["Switch to last tab", "lastTab"],
    ],
  },
  {
    title: "Request",
    items: [
      ["Save Request", "save"],
      ["Send Request", "send"],
      ["Go to URL bar", "focusUrl"],
    ],
  },
  {
    title: "Sidebar",
    items: [
      ["Search Requests", "search"],
      ["Toggle sidebar", "toggleSidebar"],
    ],
  },
  {
    title: "Windows and modals",
    items: [
      ["Open Settings", "settings"],
      ["Open Shortcuts", "shortcuts"],
      ["Close window", "closeWindow"],
    ],
  },
  {
    title: "Interface",
    items: [
      ["Zoom in", "zoomIn"],
      ["Zoom out", "zoomOut"],
      ["Reset zoom", "zoomReset"],
      ["Toggle full screen", "fullscreen"],
    ],
  },
];

/** Keys of one shortcut as separate caps; a range ("⌘1 – ⌘8") keeps its dash between them. */
function Keys({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label.split(" – ").map((part, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <span className="mx-0.5 text-z-faint">–</span>}
          {keyCaps(part).map((c, j) => (
            <kbd
              key={j}
              className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded border border-z-border-strong bg-z-elevated px-1.5 font-sans text-sm text-z-text"
            >
              {c}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  );
}

/** Settings → Shortcuts: the app's keyboard shortcuts (Postman's keys), in this platform's notation. */
export function ShortcutList() {
  return (
    <>
      {GROUPS.map((g) => (
        <SettingSection key={g.title} title={g.title}>
          {g.items.map(([label, key]) => (
            <SettingRow key={key} label={label}>
              <Keys label={SHORTCUTS[key]} />
            </SettingRow>
          ))}
        </SettingSection>
      ))}
    </>
  );
}
