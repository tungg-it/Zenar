// Per-machine UI session, restored on the next launch: the last open Collection and, per Collection,
// its open Request tabs. Kept in localStorage like the theme; never saved to the repo.

const STORAGE_KEY = "zenar.session";

export type TabSession = {
  /** Request ids open as tabs, in tab order. */
  tabs: string[];
  /** The tab in front, or null when none (e.g. Headers & auth shown). */
  selectedId: string | null;
};

type Session = {
  /** Library id of the Collection open when the app was closed. */
  collectionId: string | null;
  /** Keyed by the Collection's root path. */
  tabs: Record<string, TabSession>;
};

function read(): Session {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (v && typeof v === "object") return { collectionId: v.collectionId ?? null, tabs: v.tabs ?? {} };
  } catch {
    /* missing or unreadable: start empty */
  }
  return { collectionId: null, tabs: {} };
}

function write(s: Session) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: the session lasts until the app closes */
  }
}

export const lastCollectionId = () => read().collectionId;

export const rememberCollection = (collectionId: string | null) => write({ ...read(), collectionId });

export const tabSession = (root: string): TabSession => read().tabs[root] ?? { tabs: [], selectedId: null };

export function rememberTabs(root: string, t: TabSession) {
  const s = read();
  write({ ...s, tabs: { ...s.tabs, [root]: t } });
}

export function forgetTabs(root: string) {
  const s = read();
  delete s.tabs[root];
  write(s);
}
