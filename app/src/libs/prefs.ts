// Per-machine UI preferences, kept in localStorage like the theme; never saved to the repo.

const DISCARD_ON_CLOSE = "zenar.discardOnClose";
const RIGHT_PANEL = "zenar.rightPanel";

/** Closing a tab with unsaved changes discards them without asking. */
export function discardOnClose(): boolean {
  try {
    return localStorage.getItem(DISCARD_ON_CLOSE) === "1";
  } catch {
    return false;
  }
}

export function setDiscardOnClose(on: boolean) {
  try {
    if (on) localStorage.setItem(DISCARD_ON_CLOSE, "1");
    else localStorage.removeItem(DISCARD_ON_CLOSE);
  } catch {
    /* storage unavailable: the choice lasts for this session only */
  }
}

export type RightPanel = { open: boolean; view: string };

/** Right sidebar: shown or hidden, and the view it shows ("variables" / "code"). */
export function rightPanel(): RightPanel {
  try {
    const v = JSON.parse(localStorage.getItem(RIGHT_PANEL) ?? "null");
    if (v && typeof v === "object") return { open: !!v.open, view: String(v.view ?? "") };
  } catch {
    /* missing or unreadable: default below */
  }
  return { open: false, view: "" };
}

export function setRightPanel(p: RightPanel) {
  try {
    localStorage.setItem(RIGHT_PANEL, JSON.stringify(p));
  } catch {
    /* storage unavailable: the choice lasts for this session only */
  }
}

const SNIPPET = "zenar.snippet";

/** Code snippet view: chosen language and generator options (stored as given, validated by the caller). */
export function snippetPrefs(): Record<string, unknown> {
  try {
    const v = JSON.parse(localStorage.getItem(SNIPPET) ?? "null");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function setSnippetPrefs(p: Record<string, unknown>) {
  try {
    localStorage.setItem(SNIPPET, JSON.stringify(p));
  } catch {
    /* storage unavailable: the choice lasts for this session only */
  }
}

const LAYOUT = "zenar.layout";

/** Dragged sizes in px: left / right sidebar width, Request editor height (null = the default size). */
export type Layout = { left: number | null; right: number | null; editor: number | null };

export function layoutPrefs(): Layout {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  try {
    const v = JSON.parse(localStorage.getItem(LAYOUT) ?? "null");
    if (v && typeof v === "object") return { left: num(v.left), right: num(v.right), editor: num(v.editor) };
  } catch {
    /* missing or unreadable: default below */
  }
  return { left: null, right: null, editor: null };
}

export function setLayoutPrefs(l: Layout) {
  try {
    localStorage.setItem(LAYOUT, JSON.stringify(l));
  } catch {
    /* storage unavailable: the sizes last for this session only */
  }
}

const ZOOM = "zenar.zoom";

/** Interface zoom (1 = 100%), set with ⌘+ / ⌘- / ⌘0. */
export function zoomLevel(): number {
  try {
    const v = Number(localStorage.getItem(ZOOM));
    return v >= 0.5 && v <= 2 ? v : 1;
  } catch {
    return 1;
  }
}

export function setZoomLevel(z: number) {
  try {
    if (z === 1) localStorage.removeItem(ZOOM);
    else localStorage.setItem(ZOOM, String(z));
  } catch {
    /* storage unavailable: the zoom lasts for this session only */
  }
}
