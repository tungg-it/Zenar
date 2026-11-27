import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Alert, App as AntApp, Button, Empty, Input } from "antd";
import {
  LuDownload,
  LuFilePlus,
  LuFolderPlus,
  LuLayers,
  LuListFilter,
  LuPackage,
  LuPlus,
  LuRefreshCw,
  LuSlidersHorizontal,
} from "react-icons/lu";
import type { AttentionItem } from "@/bindings/AttentionItem";
import type { Auth } from "@/bindings/Auth";
import type { Change } from "@/bindings/Change";
import type { CollectionData } from "@/bindings/CollectionData";
import type { ConflictInfo } from "@/bindings/ConflictInfo";
import type { DraftAlert } from "@/bindings/DraftAlert";
import type { EnvironmentItem } from "@/bindings/EnvironmentItem";
import type { PlacedTokenWarning } from "@/bindings/PlacedTokenWarning";
import type { TokenWarning } from "@/bindings/TokenWarning";
import type { HttpResponse } from "@/bindings/HttpResponse";
import type { KeyValue } from "@/bindings/KeyValue";
import type { RequestItem } from "@/bindings/RequestItem";
import { IconButton, preWrap, ResizeHandle, treeEmpty } from "@/components/ui";
import { cx } from "@/libs/cx";
import { orderBetween } from "@/libs/order";
import {
  RequestTabs,
  RightSidebar,
  StatusBar,
  WorkspaceHeader,
  WorkspaceSidebar,
  type RightView,
  type SidebarView,
  type TabAction,
} from "@/components/workspace";
import {
  useAutoSync,
  useOfflineQueue,
  useRequestPreview,
  useShortcuts,
  useZoom,
} from "@/hooks";
import {
  discardOnClose,
  layoutPrefs,
  rightPanel,
  setDiscardOnClose,
  setLayoutPrefs,
  setRightPanel,
  type Layout,
} from "@/libs/prefs";
import { rememberTabs, tabSession } from "@/libs/session";
import { syncedSelection } from "@/libs/sync-selection";
import { pickSavePath } from "@/service/files";
import type { MenuCommand } from "@/service/menu";
import { closeWindow, toggleFullscreen } from "@/service/window";
import {
  cancelChange,
  conflictInfo,
  discardDraft,
  exportCollection,
  overwriteChange,
  listDrafts,
  openCollection,
  putDraft,
  saveChange,
  saveOrQueue,
  saveDefaults,
} from "@/service/collection";
import {
  checkTokenWarnings,
  deleteEnvironment,
  duplicateEnvironment,
  exportTokenWarnings,
  getActiveEnvironment,
  getSecretValues,
  saveEnvironment,
  setActiveEnvironment,
} from "@/service/environment";
import {
  EMPTY_REPORT,
  sendComposed,
  sendScripted,
  type ScriptReport,
} from "@/service/runner";
import {
  CollectionManager,
  ImportMenu,
  NewMenu,
  TreeSidebar,
  type TreeHandle,
} from "./collections";
import { CodeSnippetPanel, VariablesPanel } from "./context";
import {
  EnvironmentEditor,
  EnvironmentsPanel,
  type EnvPatch,
  type EnvironmentEditorHandle,
} from "./environments";
import { HistoryPanel } from "./local";
import {
  ConflictDialog,
  DefaultsEditor,
  GonePrompt,
  RequestEditor,
  SaveRequestDialog,
  UnsavedTabDialog,
} from "./request";
import { ResponsePane } from "./response";
import { SettingsModal, type SettingsSection } from "./settings";
import { OfflineNotices } from "./sync";

// What the Response pane shows for one tab after its Send.
type SendResult = {
  response: HttpResponse | null;
  // Send failed before any response came back (connection refused, bad URL...).
  error: string | null;
  // Tests, console output and errors of the Send's scripts.
  report: ScriptReport;
  // The response is in; the post-response script is still running.
  scriptRunning?: boolean;
};

const sidebarScroll = "flex-1 overflow-auto px-1.5 pt-1 pb-3";

/** The whole app screen: one open Collection, its Requests as tabs, Save / sync / conflict flow. */
export function WorkspacePage() {
  const { modal, message } = AntApp.useApp();
  const [path, setPath] = useState("");
  const [collection, setCollection] = useState<CollectionData | null>(null);
  const [selected, setSelected] = useState<RequestItem | null>(null);
  // Last Send of each open tab, by Request id: kept while switching tabs, dropped when the tab
  // closes or another Collection opens. Memory only, so quitting the app clears it.
  const [results, setResults] = useState<Map<string, SendResult>>(new Map());
  // Tabs whose Send is still running (a Send keeps going when its tab goes to the back).
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
  // The latest Send of each tab: an older Send's script finishing late must not overwrite it.
  const lastSend = useRef(new Map<string, number>());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<DraftAlert[]>([]);
  // Drafts persisted in the local store (outside the repo); they survive restarts.
  const [drafts, setDrafts] = useState<Map<string, RequestItem>>(new Map());
  // New tabs not saved to the Collection yet, as first opened: one is unsaved once it differs.
  const [untitled, setUntitled] = useState<Map<string, RequestItem>>(new Map());
  // First Save of a new tab: asks its name and Folder, resolves null on Cancel.
  const [saveAs, setSaveAs] = useState<{
    item: RequestItem;
    resolve: (at: { name: string; folder: string } | null) => void;
  } | null>(null);

  const [conflict, setConflict] = useState<{
    change: Change;
    info: ConflictInfo;
  } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [root, setRoot] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [envId, setEnvId] = useState<string | null>(null);
  const [sendCount, setSendCount] = useState(0);
  // The selected Request was deleted by a teammate while being edited: restore or accept.
  const [gone, setGone] = useState<RequestItem | null>(null);
  // Collection or Folder whose inherited headers/auth are being edited (folder path, "" = Collection).
  const [defaults, setDefaults] = useState<{
    path: string | null;
    headers: KeyValue[];
    auth: Auth | undefined;
  } | null>(null);
  // Environment open as a tab (base = as last read or saved, null for a new one). It stays in the
  // tab bar while a Request is in front, and is in front itself when nothing else is.
  const [envTab, setEnvTab] = useState<{
    base: EnvironmentItem | null;
    draft: EnvironmentItem;
  } | null>(null);
  const envEditor = useRef<EnvironmentEditorHandle>(null);
  // The Collection as last rendered, for async callbacks that started on an older render.
  const shownCollection = useRef<CollectionData | null>(null);

  // Shell state (layout only).
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarView, setSidebarView] = useState<SidebarView>("collections");
  const [filter, setFilter] = useState("");
  // Right sidebar (Variables / Code snippet): shown or hidden like the left one, remembered per machine.
  const [right, setRight] = useState<{ open: boolean; view: RightView }>(() => {
    const p = rightPanel();
    return { open: p.open, view: p.view === "code" ? "code" : "variables" };
  });
  // Dragged sizes of the sidebars and the Request editor, remembered per machine.
  const [layout, setLayout] = useState(layoutPrefs);
  const resize = (l: Partial<Layout>) =>
    setLayout((prev) => ({ ...prev, ...l }));
  useEffect(() => setLayoutPrefs(layout), [layout]);
  const split = useRef<HTMLDivElement>(null);
  const zoom = useZoom();
  const showZoom = (z: number) =>
    message.info({
      key: "zoom",
      content: `Zoom ${Math.round(z * 100)}%`,
      duration: 1.2,
    });
  // Request ids open as tabs, in tab order.
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  // Root whose saved tabs have been restored; tabs are only remembered after that, so the empty
  // tab list of a just-opened Collection never overwrites what was saved.
  const restoredRoot = useRef<string | null>(null);
  // Tabs being closed with unsaved changes, asked one at a time: Save / Don't save / Cancel.
  const [closing, setClosing] = useState<RequestItem[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  // Closed tab ids, most recent last, for "Reopen last closed tab".
  const closedTabs = useRef<string[]>([]);
  const tree = useRef<TreeHandle>(null);
  // Tree action asked for while the tree was hidden: run once the Collections view is shown.
  const pendingTree = useRef<((t: TreeHandle) => void) | null>(null);

  // Auto-sync (open, focus, every minute). Remote changes to untouched Requests apply silently;
  // an edited Request (Draft) is never replaced, it only gets the "vừa sửa" notice.
  const { failure: syncFailure, syncing: fetching, syncNow } = useAutoSync(root || null, (r) => {
    setCollection((prev) => {
      setSelected((cur) =>
        syncedSelection(prev?.requests ?? [], r.data.requests, cur),
      );
      return r.data;
    });
    setAlerts(r.draft_alerts);
  });

  const offline = useOfflineQueue(root || null, async () => {
    // Queued Saves were pushed (or conflicted): refresh the list and the Drafts.
    try {
      setCollection(await openCollection(root));
      setDrafts(
        new Map((await listDrafts(root)).map((d) => [d.request_id, d.draft])),
      );
    } catch {
      /* ignore */
    }
  });

  // Drops the cached Send results of these tabs (all of them without ids).
  const dropResults = (ids?: string[]) =>
    setResults((m) => {
      if (!ids) return m.size ? new Map() : m;
      if (!ids.some((id) => m.has(id))) return m;
      const n = new Map(m);
      ids.forEach((id) => n.delete(id));
      return n;
    });

  const result = selected ? results.get(selected.id) : undefined;
  const sending = !!selected && sendingIds.has(selected.id);

  const openTab = (id: string) =>
    setOpenTabs((t) => (t.includes(id) ? t : [...t, id]));

  function selectRequest(r: RequestItem) {
    setSelected(drafts.get(r.id) ?? r);
    openTab(r.id);
    setDefaults(null);
    setError(null);
    setGone(null);
    setConflict(null);
  }

  // Removes tabs; when the active one goes, the tab after it (or the last one left) comes to the front.
  function removeTabs(ids: string[], activeId = selected?.id ?? null) {
    const rest = openTabs.filter((x) => !ids.includes(x));
    closedTabs.current = [
      ...closedTabs.current.filter((x) => !ids.includes(x)),
      ...openTabs.filter((x) => ids.includes(x)),
    ].slice(-20);
    setOpenTabs(rest);
    setUntitled((m) => {
      if (!ids.some((id) => m.has(id))) return m;
      const n = new Map(m);
      ids.forEach((id) => n.delete(id));
      return n;
    });
    dropResults(ids);
    if (!activeId || !ids.includes(activeId)) return;
    const i = openTabs.indexOf(activeId);
    const nextId =
      openTabs.slice(i + 1).find((x) => !ids.includes(x)) ??
      rest[rest.length - 1];
    const next = nextId ? requestById(nextId) : undefined;
    setSelected(next ?? null);
  }

  // Clean tabs close at once; unsaved ones ask first, one dialog per tab in tab order, like Postman.
  // `force` (or the "always discard" setting) drops their changes without asking.
  function closeTabs(ids: string[], force = false) {
    const dirty = ids.filter(isDirty);
    if (force || discardOnClose()) return void discardAndClose(ids, dirty);
    removeTabs(ids.filter((id) => !dirty.includes(id)));
    setClosing(dirty.map(requestById).filter((r): r is RequestItem => !!r));
  }

  async function discardAndClose(ids: string[], dirty = ids.filter(isDirty)) {
    await Promise.all(
      dirty.map((id) => discardDraft(root, id).catch(() => {})),
    );
    setDrafts((m) => {
      const n = new Map(m);
      dirty.forEach((id) => n.delete(id));
      return n;
    });
    removeTabs(ids);
  }

  async function saveAndClose(item: RequestItem) {
    // Bring the tab to the front first: a Conflict or deletion is resolved there, with the tab left open.
    if (selected?.id !== item.id) {
      setSelected(item);
      setDefaults(null);
    }
    const ok = await save(item);
    // A failed Save stops the remaining questions too: the user deals with this tab first.
    setClosing((q) => (ok ? q.slice(1) : []));
    if (ok) removeTabs([item.id], item.id);
  }

  // The tree lives in the sidebar's Collections view; show it first when hidden.
  function withTree(fn: (t: TreeHandle) => void) {
    if (tree.current && sidebarOpen && sidebarView === "collections")
      return fn(tree.current);
    pendingTree.current = fn;
    setSidebarOpen(true);
    setSidebarView("collections");
  }

  useEffect(() => {
    if (!pendingTree.current || !tree.current) return;
    pendingTree.current(tree.current);
    pendingTree.current = null;
  }, [sidebarOpen, sidebarView]);

  // A new, unsaved Request in its own tab, like Postman: it joins the Collection on its first Save.
  // A GraphQL Request is a POST whose body is the query.
  function newRequest(kind: "http" | "graphql" = "http") {
    const graphql = kind === "graphql";
    const r: RequestItem = {
      id: crypto.randomUUID(),
      name: "Untitled Request",
      order: 0,
      method: graphql ? "POST" : "GET",
      url: "",
      folder: "",
      params: [],
      path_variables: [],
      headers: [],
      body: graphql ? "" : null,
      body_type: graphql ? "graphql" : null,
      body_extra: graphql ? { variables: "" } : null,
      extra: graphql ? { kind: "graphql" } : null,
      captures: [],
      scripts: { pre_request: "", post_response: "" },
      path: "",
    };
    setUntitled((m) => new Map(m).set(r.id, r));
    selectRequest(r);
    requestAnimationFrame(() => focusField("request-url"));
  }

  function onTabMenu(action: TabAction, r: RequestItem) {
    if (action === "new") return newRequest();
    if (action === "duplicate")
      return withTree((t) => t.duplicate(requestById(r.id) ?? r));
    if (action === "close") return closeTabs([r.id]);
    if (action === "force-close") return closeTabs([r.id], true);
    if (action === "close-others")
      return closeTabs(openTabs.filter((id) => id !== r.id));
    closeTabs(openTabs, action === "force-close-all");
  }

  // ⌘W / ⌥⌘W close the tab in front; with the Headers & auth or Environment tab in front, that one.
  const closeActive = (force: boolean) =>
    selected
      ? closeTabs([selected.id], force)
      : defaults
        ? setDefaults(null)
        : envTab && closeEnvTab(force);
  const activateTab = (id: string | undefined) => {
    const r = id && requestById(id);
    if (r) selectRequest(r);
  };
  // ⇧⌘] / ⇧⌘[ move through the tabs and wrap around, like Postman.
  const stepTab = (by: number) => {
    if (!tabs.length) return;
    const i = selected ? tabs.indexOf(selected.id) : -1;
    activateTab(tabs[(i + by + tabs.length) % tabs.length]);
  };
  const focusField = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  };
  const gotoTab = (n: number) => () =>
    activateTab(n === 9 ? tabs[tabs.length - 1] : tabs[n - 1]);
  const commands: Record<MenuCommand, () => void> = {
    "tab:new": () => collection && !readOnly && newRequest(),
    "tab:save": () => {
      if (readOnly || saving) return;
      if (defaults) saveInheritedDefaults();
      else if (envFront) envEditor.current?.save();
      else if (dirty) save();
    },
    "tab:close": () => closeActive(false),
    "tab:force-close": () => closeActive(true),
    "view:zoom-in": () => showZoom(zoom.zoomIn()),
    "view:zoom-out": () => showZoom(zoom.zoomOut()),
    "view:zoom-reset": () => showZoom(zoom.resetZoom()),
    "tab:reopen": () => {
      // Skip ids that are open again or no longer in the Collection.
      while (closedTabs.current.length) {
        const id = closedTabs.current.pop()!;
        if (
          !openTabs.includes(id) &&
          collection?.requests.some((x) => x.id === id)
        )
          return activateTab(id);
      }
    },
    "tab:next": () => stepTab(1),
    "tab:prev": () => stepTab(-1),
    "tab:goto-1": gotoTab(1),
    "tab:goto-2": gotoTab(2),
    "tab:goto-3": gotoTab(3),
    "tab:goto-4": gotoTab(4),
    "tab:goto-5": gotoTab(5),
    "tab:goto-6": gotoTab(6),
    "tab:goto-7": gotoTab(7),
    "tab:goto-8": gotoTab(8),
    "tab:goto-9": gotoTab(9),
    "request:send": () => selected && !defaults && !sending && send(),
    "request:focus-url": () =>
      selected && !defaults && focusField("request-url"),
    "view:toggle-sidebar": () => setSidebarOpen((o) => !o),
    "view:search": () => collection && focusField("request-search"),
    "view:fullscreen": () => void toggleFullscreen(),
    "window:close": () => void closeWindow(),
    "app:settings": () => setSettings((s) => s ?? "general"),
    "app:shortcuts": () => setSettings("shortcuts"),
    "app:about": () => setSettings("general"),
  };
  useShortcuts(commands);

  // Hard-coded credentials leave the app with the file (and Postman asks to put them in its Vault):
  // name each place before exporting; a click opens it to switch to a {{variable}}.
  function confirmTokens(found: PlacedTokenWarning[]) {
    const what = (w: TokenWarning) =>
      w.location === "body"
        ? "body"
        : w.location === "auth"
          ? `${w.name} auth`
          : `header ${w.name}${w.disabled ? " (disabled)" : ""}`;
    return new Promise<boolean>((resolve) => {
      const open = (p: PlacedTokenWarning) => {
        dialog.destroy();
        resolve(false);
        if (p.kind === "collection") return showDefaults(null);
        const f = collection?.folders.find((x) => x.id === p.id);
        if (f) return showDefaults(f.path);
        const r = collection?.requests.find((x) => x.id === p.id);
        if (r) selectRequest(r);
      };
      const dialog = modal.confirm({
        title: "Hard-coded tokens in this Collection",
        width: 520,
        content: (
          <>
            <p className="mb-2">
              Anyone with the exported file can read them, and Postman asks to put them in its Vault. Replace them with
              a {"{{variable}}"} (a Secret in an Environment) before exporting.
            </p>
            <ul className="m-0 max-h-60 list-none overflow-auto p-0">
              {found.map((p) => (
                <li key={p.kind + p.id} className="py-0.5">
                  <button
                    className="cursor-pointer border-0 bg-transparent p-0 text-left text-z-primary hover:underline"
                    onClick={() => open(p)}
                  >
                    {p.kind === "collection" ? "Collection headers & auth" : p.place}
                  </button>
                  <span className="text-z-muted"> · {p.warnings.map(what).join(", ")}</span>
                </li>
              ))}
            </ul>
          </>
        ),
        okText: "Export anyway",
        okButtonProps: { danger: true },
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }

  async function exportToPostman() {
    if (!collection) return;
    try {
      const found = await exportTokenWarnings(root);
      if (found.length && !(await confirmTokens(found))) return;
      const file = await pickSavePath("Export Collection", `${collection.name}.postman_collection.json`);
      if (!file) return;
      const skipped = await exportCollection(root, file);
      if (skipped.length) message.warning(`Exported "${collection.name}" (${skipped.length} skipped: ${skipped.join("; ")})`, 8);
      else message.success(`Exported "${collection.name}"`);
    } catch (e) {
      message.error(String(e), 8);
    }
  }

  function showDefaults(folderPath: string | null) {
    if (!collection) return;
    const f =
      folderPath === null
        ? null
        : collection.folders.find((x) => x.path === folderPath);
    setSelected(null);
    setDefaults(
      f
        ? { path: f.path, headers: f.headers, auth: f.auth }
        : { path: null, headers: collection.headers, auth: collection.auth },
    );
  }

  const envDirty =
    !!envTab && JSON.stringify(envTab.base) !== JSON.stringify(envTab.draft);
  const envFront = !!envTab && !selected && !defaults;
  const discardEnvEdits = async () =>
    !envDirty ||
    (await modal.confirm({
      title: `Discard unsaved changes to ${envTab!.draft.name || "this Environment"}?`,
      okText: "Discard",
      okButtonProps: { danger: true },
    }));

  // Opens an Environment's variables in the tab bar (null: a new Environment), like Postman.
  async function openEnvironment(e: EnvironmentItem | null) {
    if (!collection) return;
    if (!(e && envTab?.draft.id === e.id) && !(await discardEnvEdits())) return;
    setSelected(null);
    setDefaults(null);
    if (e && envTab?.draft.id === e.id) return;
    // Secret values are this machine's, filled in so they show (masked) and can be changed.
    const draft = e
      ? withSecrets(e, await getSecretValues(root, e).catch(() => ({})))
      : {
          id: crypto.randomUUID(),
          name: "New Environment",
          // Last; drag and drop leaves fractional orders, so not the count.
          order: Math.max(0, ...collection.environments.map((x) => x.order)) + 1,
          variables: [],
          path: "",
        };
    setEnvTab({ base: e && draft, draft });
  }

  // `e` with its Secret variables' `value` taken from `values` (by variable id).
  const withSecrets = (e: EnvironmentItem, values: Record<string, string>): EnvironmentItem => ({
    ...e,
    variables: e.variables.map((v) => (v.secret ? { ...v, value: values[v.id] ?? "" } : { ...v })),
  });
  const secretsOf = (e: EnvironmentItem) =>
    Object.fromEntries(e.variables.filter((v) => v.secret).map((v) => [v.id, v.value]));

  async function closeEnvTab(force = false) {
    if (force || (await discardEnvEdits())) setEnvTab(null);
  }

  async function envSaved(e: EnvironmentItem) {
    setEnvTab({ base: e, draft: e });
    setCollection(await openCollection(root));
    if (!envId) pickEnv(e.id);
  }

  // From the Environments list, which hides / moves the row at once; a failure rejects and the reload shows the truth.
  async function deleteEnv(e: EnvironmentItem) {
    try {
      await deleteEnvironment(root, e.id);
      setEnvTab((t) => (t?.base?.id === e.id ? null : t));
      setEnvId((id) => (id === e.id ? null : id));
    } finally {
      setCollection(await openCollection(root));
    }
  }

  // Rename or move: merged by Field like any Environment Save, so other Members' edits are kept.
  async function updateEnv(e: EnvironmentItem, patch: EnvPatch) {
    try {
      const r = await saveEnvironment(root, e, { ...e, ...patch });
      if (r.status === "conflict")
        throw `Could not change "${e.name}": another Member changed or deleted it.`;
    } finally {
      setCollection(await openCollection(root));
    }
  }

  async function duplicateEnv(e: EnvironmentItem, copy: EnvironmentItem) {
    let data: CollectionData | null = null;
    try {
      await duplicateEnvironment(root, e.id, copy);
    } finally {
      data = await openCollection(root);
      setCollection(data);
    }
    const saved = data.environments.find((x) => x.id === copy.id);
    if (saved) await openEnvironment(saved);
  }

  function pickEnv(id: string | null) {
    setEnvId(id);
    if (root) setActiveEnvironment(root, id).catch((e) => setError(String(e)));
  }

  async function openAttention(item: AttentionItem) {
    setError(null);
    try {
      const info = await conflictInfo(root, item.change);
      if (item.change.kind === "delete") return;
      const mine: RequestItem =
        item.change.kind === "create"
          ? (item.change as unknown as RequestItem)
          : item.change.ours;
      setSelected(mine);
      openTab(mine.id);
      setConflict({ change: item.change, info });
    } catch (e) {
      setError(String(e));
    }
  }

  async function open() {
    setError(null);
    dropResults();
    setSelected(null);
    setOpenTabs([]);
    setUntitled(new Map());
    try {
      setCollection(await openCollection(path.trim()));
      setRoot(path.trim());
      setDefaults(null);
      setEnvTab(null);
      setSettings(null);
    } catch (e) {
      setCollection(null);
      // Stop auto-sync / offline queue for the previous Collection, or it would reappear.
      setRoot("");
      setError(String(e));
    }
  }

  async function send() {
    if (!selected) return;
    const id = selected.id;
    setError(null);
    dropResults([id]);
    const token = (lastSend.current.get(id) ?? 0) + 1;
    lastSend.current.set(id, token);
    setSendingIds((s) => new Set(s).add(id));
    const doneSending = () =>
      setSendingIds((s) => {
        if (!s.has(id)) return s;
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    // The result goes to the tab that sent it, even if another tab is in front by then.
    const keep = (r: SendResult) => {
      if (lastSend.current.get(id) === token) setResults((m) => new Map(m).set(id, r));
    };
    try {
      const out = await sendScripted(root, selected, activeEnv, readOnly, (response, report) => {
        // Show the response now; the post-response script finishes in the background.
        keep({ response, error: null, report, scriptRunning: !!selected.scripts?.post_response.trim() });
        doneSending();
      });
      keep({ response: out.response, error: out.error, report: out.report });
      // A script wrote the active Environment: show its new values everywhere.
      if (out.environmentChanged) setCollection(await openCollection(root));
    } catch (e) {
      keep({ response: null, error: String(e), report: EMPTY_REPORT });
    } finally {
      doneSending();
    }
    setSendCount((n) => n + 1);
  }

  // Returns true once the Request is saved (shared or committed), false when it stays a Draft.
  async function save(item: RequestItem | null = selected): Promise<boolean> {
    if (!item) return false;
    setError(null);
    const id = item.id;
    if (collection && !collection.requests.some((r) => r.id === id)) {
      // Not in the Collection yet (a new tab): ask where it goes first.
      const asked = item;
      const at = await new Promise<{ name: string; folder: string } | null>(
        (resolve) => setSaveAs({ item: asked, resolve }),
      );
      setSaveAs(null);
      if (!at) return false;
      const last = collection.requests
        .filter((r) => r.folder === at.folder)
        .reduce<number | null>((m, r) => (m === null || r.order > m ? r.order : m), null);
      item = { ...item, ...at, order: orderBetween(last, null) };
      const named = item;
      setSelected((cur) => (cur?.id === named.id ? named : cur));
    }
    try {
      // Warn (not block) when a header or the body looks like a hard-coded token.
      const warnings = await checkTokenWarnings(item);
      if (warnings.length > 0) {
        const where = warnings
          .map((w) => (w.location === "body" ? "the body" : `header ${w.name}`))
          .join(", ");
        const ok = await modal.confirm({
          title: "Hard-coded token?",
          content: `This Request looks like it contains a hard-coded token in ${where}. Saving shares it with every Member. Use a Secret variable like {{token}} instead. Save anyway?`,
          okText: "Save anyway",
          okButtonProps: { danger: true },
        });
        if (!ok) return false;
      }
      setSaving(true);
      const base = collection?.requests.find((r) => r.id === item.id);
      const folderId =
        collection?.folders.find((f) => f.path === item.folder)?.id ?? null;
      const change: Change = base
        ? { kind: "update", base, ours: item }
        : { kind: "create", ...item };
      const result = await saveOrQueue(root, change, folderId);
      setNotice(null);
      if (result.status === "conflict") {
        // The change stays a Draft until the user picks Overwrite or Cancel (or restore / accept deletion).
        await putDraft(root, base ?? null, item);
        if (
          base &&
          result.theirs === null &&
          result.fields.includes(`requests/${item.id}`)
        ) {
          setGone(item); // deleted by a teammate: restore or accept (GonePrompt)
          return false;
        }
        setConflict({ change, info: await conflictInfo(root, change) });
        return false;
      }
      if (result.status === "queued") {
        setNotice(
          "You are offline. Your Save is queued and will be shared automatically when you are back online.",
        );
        await putDraft(root, base ?? null, item);
        offline.refresh();
        return false;
      }
      if (result.status === "draft") {
        // Protected branch / no write access: the change stays a Draft.
        await putDraft(root, base ?? null, item);
        setNotice(result.reason.message);
        offline.refresh();
        return false;
      }
      await discardDraft(root, id);
      setDrafts((m) => {
        const n = new Map(m);
        n.delete(id);
        return n;
      });
      setUntitled((m) => {
        const n = new Map(m);
        n.delete(id);
        return n;
      });
      offline.refresh();
      setCollection(await openCollection(root));
      if (result.request) setSelected(result.request);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function restoreGone() {
    if (!gone) return;
    try {
      const folderId =
        collection?.folders.find((f) => f.path === gone.folder)?.id ?? null;
      const r = await saveChange(root, { kind: "create", ...gone }, folderId);
      if (r.status === "conflict")
        throw new Error(`Cannot restore: ${r.fields.join(", ")}`);
      await discardDraft(root, gone.id);
      setCollection(await openCollection(root));
      setSelected(r.request ?? gone);
      setError(null);
      setGone(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function acceptGone() {
    if (!gone) return;
    await discardDraft(root, gone.id).catch(() => {});
    setDrafts((m) => {
      const n = new Map(m);
      n.delete(gone.id);
      return n;
    });
    setOpenTabs((t) => t.filter((x) => x !== gone.id));
    dropResults([gone.id]);
    setGone(null);
    setSelected(null);
    setError(null);
    setCollection(await openCollection(root));
  }

  async function resolveConflict(overwrite: boolean) {
    if (!conflict) return;
    setError(null);
    setResolving(true);
    try {
      if (overwrite) {
        const result = await overwriteChange(root, conflict.change);
        await discardDraft(root, selected?.id ?? "");
        setCollection(await openCollection(root));
        if (result.status === "saved" && result.request)
          setSelected(result.request);
        else setSelected(null);
      } else {
        const d = await cancelChange(root, conflict.change);
        setCollection(await openCollection(root));
        if (d) setDrafts((m) => new Map(m).set(d.request_id, d.draft));
        setSelected(d ? d.draft : null);
      }
      setConflict(null);
      offline.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setResolving(false);
    }
  }

  // Collection / Folder defaults are shared like a Request Save: merged by Field with what other
  // Members saved meanwhile, a clash on the same Field asks before overwriting.
  async function saveInheritedDefaults(overwrite = false): Promise<void> {
    if (!defaults || !collection) return;
    setError(null);
    setSaving(true);
    try {
      const folder =
        defaults.path === null
          ? undefined
          : collection.folders.find((x) => x.path === defaults.path)!;
      const base = folder ?? collection;
      const result = await saveDefaults(
        root,
        folder?.id ?? null,
        { headers: base.headers, auth: base.auth },
        { headers: defaults.headers, auth: defaults.auth },
        overwrite,
      );
      if (result.status === "conflict") {
        const ok = await modal.confirm({
          title: "Changed by another Member",
          content: `Another Member changed ${result.fields.join(", ")} meanwhile. Overwrite their change with yours?`,
          okText: "Overwrite",
          okButtonProps: { danger: true },
        });
        if (ok) return saveInheritedDefaults(true);
        setCollection(await openCollection(root));
        return;
      }
      setCollection(await openCollection(root));
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  shownCollection.current = collection;
  const saved = collection?.requests.find((r) => r.id === selected?.id);
  const dirty =
    !!selected &&
    JSON.stringify(saved ?? untitled.get(selected.id)) !==
      JSON.stringify(selected);

  useEffect(() => {
    if (!root) return;
    listDrafts(root)
      .then((l) => setDrafts(new Map(l.map((d) => [d.request_id, d.draft]))))
      .catch(() => {});
  }, [root]);

  // The active Environment is a local choice, remembered per Collection on this machine.
  useEffect(() => {
    if (!root) return;
    getActiveEnvironment(root)
      .then((id) =>
        setEnvId(
          id && collection?.environments.some((e) => e.id === id) ? id : null,
        ),
      )
      .catch((e) => setError(String(e)));
  }, [root]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!root || !selected) return;
    // Edited back to what is saved: the Draft is stale, drop it (or reselecting would bring it back).
    if (!dirty) {
      if (!drafts.has(selected.id)) return;
      const id = selected.id;
      discardDraft(root, id)
        .then(() =>
          setDrafts((m) => {
            const n = new Map(m);
            n.delete(id);
            return n;
          }),
        )
        .catch(() => {});
      return;
    }
    putDraft(root, saved ?? null, selected)
      .then(() => setDrafts((m) => new Map(m).set(selected.id, selected)))
      .catch(() => {});
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // A sync or a Save elsewhere changed the Environment open in a tab: show it, unless it has edits.
  useEffect(() => {
    if (!envTab?.base || envDirty) return;
    const found = collection?.environments.find((e) => e.id === envTab.base!.id);
    // The Collection has no Secret values: keep the ones the tab shows.
    const now = found && withSecrets(found, secretsOf(envTab.base));
    if (now && JSON.stringify(now) !== JSON.stringify(envTab.base))
      setEnvTab({ base: now, draft: now });
  }, [collection]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (root && restoredRoot.current === root)
      rememberTabs(root, { tabs: openTabs, selectedId: selected?.id ?? null });
  }, [root, openTabs, selected?.id]);

  const requestById = (id: string) =>
    selected?.id === id
      ? selected
      : (drafts.get(id) ??
        untitled.get(id) ??
        collection?.requests.find((r) => r.id === id));
  const tabs = openTabs.filter((id) => requestById(id));
  const isDirty = (id: string) =>
    selected?.id === id ? dirty : drafts.has(id);
  const readOnly = !!collection?.read_only;
  const activeEnv =
    (envId && collection?.environments.find((e) => e.id === envId)) || null;
  const isSecretVar = useCallback(
    (name: string) => !!activeEnv?.variables.find((v) => v.key === name)?.secret,
    [activeEnv],
  );
  const rightShown = right.open && !!selected && !defaults;
  // Also colours the URL bar's {{variables}}, so it runs whenever a Request is open.
  const { preview, error: previewError } = useRequestPreview(
    root,
    selected && !defaults ? selected : null,
    envId,
    [sendCount, collection],
  );
  const changeRight = (next: { open: boolean; view: RightView }) => {
    setRight(next);
    setRightPanel(next);
  };

  const defaultsStats = (() => {
    if (!collection || !defaults) return [];
    if (defaults.path === null)
      return [
        `${collection.requests.length} Requests`,
        `${collection.folders.length} Folders`,
        `${collection.environments.length} Environments`,
      ];
    const n = collection.requests.filter(
      (r) =>
        r.folder === defaults.path || r.folder.startsWith(defaults.path + "/"),
    ).length;
    return [`${n} Requests`];
  })();

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <WorkspaceHeader
        collection={collection}
        onPick={selectRequest}
        onOpenSettings={() => setSettings("general")}
        onCommand={(c) => commands[c]?.()}
      />

      <div className="empty:hidden [&_.ant-alert]:rounded-none">
        {readOnly && (
          <Alert
            banner
            type="warning"
            role="status"
            title="This Collection was saved by a newer version of Zenar. Build a newer version to edit it. Until then you can open it and run Requests, but not change or Save anything."
          />
        )}
        {syncFailure && (
          <Alert
            banner
            type="warning"
            role="status"
            title={`Could not check for your teammates' Saves for a few minutes (you may be offline, or your sign-in may have expired). Your own work is safe. Details: ${syncFailure}`}
          />
        )}
        {root && (
          <OfflineNotices
            status={offline.status}
            notice={notice}
            onDismissNotice={() => setNotice(null)}
            onOpen={openAttention}
          />
        )}
      </div>

      <div
        className="flex min-h-0 flex-1"
        style={
          {
            "--sidebar-w": layout.left ? `${layout.left}px` : undefined,
            "--right-w": layout.right ? `${layout.right}px` : undefined,
          } as CSSProperties
        }
      >
        {sidebarOpen && (
          <WorkspaceSidebar view={sidebarView} onViewChange={setSidebarView}>
            {sidebarView === "collections" && (
              <>
                <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
                  <span className="font-semibold">Collections</span>
                  <span className="flex gap-1.5">
                    <NewMenu
                      canEdit={!!collection && !readOnly}
                      onPick={(kind) => {
                        if (kind === "collection") return setAddOpen(true);
                        if (kind === "request" || kind === "graphql") return newRequest(kind === "graphql" ? "graphql" : "http");
                        if (kind === "folder") return withTree((t) => t.startNew("folder", ""));
                        setSidebarView("environments");
                        void openEnvironment(null);
                      }}
                    >
                      <Button size="small" icon={<LuPlus />}>
                        New
                      </Button>
                    </NewMenu>
                    <ImportMenu
                      root={root}
                      collection={collection}
                      onImported={setCollection}
                      readOnly={readOnly}
                      cannotSave={offline.status.viewer}
                    />
                  </span>
                </div>
                {collection && (
                  <div className="flex items-center gap-0.5 px-2.5 py-1.5">
                    <Input
                      size="small"
                      prefix={<LuListFilter />}
                      placeholder="Filter requests"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      allowClear
                      aria-label="Filter requests"
                    />
                    <IconButton
                      label="New Request"
                      icon={<LuFilePlus />}
                      disabled={readOnly}
                      onClick={() => tree.current?.startNew("request")}
                    />
                    <IconButton
                      label="New Folder"
                      icon={<LuFolderPlus />}
                      disabled={readOnly}
                      onClick={() => tree.current?.startNew("folder")}
                    />
                    {/* Fetch other Members' changes now instead of waiting for the next auto-sync. */}
                    <IconButton
                      label="Fetch changes"
                      icon={<LuRefreshCw />}
                      loading={fetching}
                      onClick={() => syncNow().catch((e) => setError(String(e)))}
                    />
                  </div>
                )}
                <div className={sidebarScroll}>
                  <CollectionManager
                    addOpen={addOpen}
                    setAddOpen={setAddOpen}
                    isOpen={!!collection}
                    onOpened={async (c, rootPath) => {
                      restoredRoot.current = null;
                      setCollection(c);
                      setRoot(rootPath);
                      setEnvId(null);
                      setDefaults(null);
                      setEnvTab(null);
                      setSelected(null);
                      setOpenTabs([]);
                      setUntitled(new Map());
                      dropResults();
                      setError(null);
                      setFilter("");
                      // Reopen the tabs left open last time, a Draft in place of its saved Request.
                      const last = tabSession(rootPath);
                      const ds = new Map(
                        (await listDrafts(rootPath).catch(() => [])).map(
                          (d) => [d.request_id, d.draft],
                        ),
                      );
                      const find = (id: string) =>
                        ds.get(id) ?? c.requests.find((r) => r.id === id);
                      const tabs = last.tabs.filter((id) => find(id));
                      restoredRoot.current = rootPath;
                      setOpenTabs(tabs);
                      setSelected(
                        last.selectedId && tabs.includes(last.selectedId)
                          ? (find(last.selectedId) ?? null)
                          : null,
                      );
                    }}
                    onClosed={() => {
                      setCollection(null);
                      dropResults();
                      setRoot("");
                      setSelected(null);
                      setOpenTabs([]);
                      setUntitled(new Map());
                      setDefaults(null);
                      setEnvTab(null);
                    }}
                    onActiveClick={() => {
                      tree.current?.selectRoot();
                      showDefaults(null);
                    }}
                    activeMenu={[
                      {
                        key: "req",
                        icon: <LuFilePlus />,
                        label: "Add request",
                        disabled: readOnly,
                        onClick: () => tree.current?.startNew("request", ""),
                      },
                      {
                        key: "dir",
                        icon: <LuFolderPlus />,
                        label: "Add folder",
                        disabled: readOnly,
                        onClick: () => tree.current?.startNew("folder", ""),
                      },
                      {
                        key: "def",
                        icon: <LuSlidersHorizontal />,
                        label: "Headers & auth",
                        onClick: () => showDefaults(null),
                      },
                      {
                        key: "export",
                        icon: <LuDownload />,
                        label: "Export (Postman)",
                        onClick: () => void exportToPostman(),
                      },
                    ]}
                  >
                    {collection && (
                      <TreeSidebar
                        ref={tree}
                        root={root}
                        collection={collection}
                        readOnly={readOnly}
                        selectedId={selected?.id ?? null}
                        draftIds={
                          new Set([
                            ...drafts.keys(),
                            ...(dirty && selected ? [selected.id] : []),
                          ])
                        }
                        filter={filter}
                        onSelect={selectRequest}
                        onAdded={(r) => {
                          setCollection((c) => c && { ...c, requests: [...c.requests, r] });
                          selectRequest(r);
                        }}
                        onEditDefaults={showDefaults}
                        onError={setError}
                        onChanged={async (select) => {
                          const c = await openCollection(root);
                          setCollection(c);
                          if (select) {
                            openTab(select.id);
                            setDefaults(null);
                          }
                          setSelected((cur) => {
                            if (select) return select;
                            const fresh = cur && c.requests.find((x) => x.id === cur.id);
                            if (!fresh) return null;
                            // Unedited since the last load (e.g. a duplicate saved in the background): take the saved copy.
                            const before = shownCollection.current?.requests.find((x) => x.id === cur!.id);
                            return before && JSON.stringify(before) === JSON.stringify(cur) ? fresh : cur;
                          });
                        }}
                      />
                    )}
                  </CollectionManager>
                  {collection && collection.broken.length > 0 && (
                    <p className={cx(treeEmpty, "text-z-post")}>
                      {collection.broken.length} unreadable file(s)
                    </p>
                  )}
                </div>
              </>
            )}
            {sidebarView === "environments" && (
              <>
                <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
                  <span className="font-semibold">Environments</span>
                  <span className="flex gap-1.5">
                    <Button
                      size="small"
                      icon={<LuPlus />}
                      disabled={!collection || readOnly}
                      onClick={() => void openEnvironment(null)}
                    >
                      New
                    </Button>
                    <ImportMenu
                      root={root}
                      collection={collection}
                      onImported={setCollection}
                      readOnly={readOnly}
                      cannotSave={offline.status.viewer}
                    />
                  </span>
                </div>
              <div className={sidebarScroll}>
                {collection && root ? (
                  <EnvironmentsPanel
                    root={root}
                    collection={collection}
                    envId={envId}
                    openId={envTab?.base?.id ?? null}
                    onOpen={openEnvironment}
                    onDelete={deleteEnv}
                    onUpdate={updateEnv}
                    onDuplicate={duplicateEnv}
                    readOnly={readOnly}
                  />
                ) : (
                  <p className={treeEmpty}>
                    Open a Collection to see its Environments.
                  </p>
                )}
              </div>
              </>
            )}
            {sidebarView === "history" && (
              <div className={sidebarScroll}>
                {root ? (
                  <HistoryPanel root={root} refreshKey={sendCount} />
                ) : (
                  <p className={treeEmpty}>
                    Open a Collection to see its history.
                  </p>
                )}
              </div>
            )}
          </WorkspaceSidebar>
        )}
        {sidebarOpen && (
          <ResizeHandle
            axis="x"
            target="prev"
            min={220}
            max={560}
            onResize={(left) => resize({ left })}
            onReset={() => resize({ left: null })}
            label="Resize sidebar"
          />
        )}

        <main className="flex min-w-0 flex-1 flex-col bg-z-bg">
          <RequestTabs
            tabs={tabs.map((id) => requestById(id)!)}
            activeId={selected?.id ?? null}
            isDirty={isDirty}
            overviews={[
              ...(defaults && collection
                ? [
                    {
                      key: "defaults",
                      title: defaults.path ?? collection.name,
                      icon: <LuPackage />,
                      active: true,
                      onActivate: () => {},
                      onClose: () => setDefaults(null),
                    },
                  ]
                : []),
              ...(envTab
                ? [
                    {
                      key: "env",
                      title: envTab.draft.name || "Untitled Environment",
                      icon: <LuLayers />,
                      dirty: envDirty,
                      active: envFront,
                      onActivate: () => openEnvironment(envTab.draft),
                      onClose: () => closeEnvTab(),
                    },
                  ]
                : []),
            ]}
            onActivate={selectRequest}
            onClose={(id) => closeTabs([id])}
            onTabMenu={onTabMenu}
            onNew={collection ? () => newRequest() : null}
            newDisabled={readOnly}
            environments={collection?.environments ?? null}
            envId={envId}
            onEnvChange={pickEnv}
          />

          {/* With a Request open the editor / Response split fills this height and each half scrolls on its own;
              the other views scroll here. */}
          <div className={cx("flex min-h-0 flex-1 flex-col", selected && !defaults ? "overflow-hidden" : "overflow-auto")}>
            {(error ||
              (selected && alerts.some((a) => a.request_id === selected.id)) ||
              gone) && (
              <div className="flex flex-col gap-1.5 px-4 pt-2">
                {error && (
                  <Alert
                    type="error"
                    showIcon
                    title={<span className={preWrap}>{error}</span>}
                    closable={{ onClose: () => setError(null) }}
                  />
                )}
                {selected &&
                  alerts.some((a) => a.request_id === selected.id) && (
                    <Alert
                      type="info"
                      showIcon
                      title={`${alerts.find((a) => a.request_id === selected.id)?.author ?? "Someone"} vừa sửa Request này`}
                    />
                  )}
                {gone && (
                  <GonePrompt
                    item={gone}
                    onRestore={restoreGone}
                    onAccept={acceptGone}
                  />
                )}
              </div>
            )}
            {selected && !defaults && (
              <div
                ref={split}
                // Dragged to a size (`is-sized`): RequestEditor takes --editor-h, still leaving the response room.
                className={cx(
                  "group/split flex min-h-0 flex-1 flex-col",
                  layout.editor ? "is-sized" : null,
                )}
                style={
                  {
                    "--editor-h": layout.editor
                      ? `${layout.editor}px`
                      : undefined,
                  } as CSSProperties
                }
              >
                <RequestEditor
                  item={selected}
                  // A new tab is not in the Collection yet: no breadcrumb, like Postman.
                  crumbs={
                    saved
                      ? [
                          collection?.name ?? "",
                          ...(selected.folder ? selected.folder.split("/") : []),
                        ].filter(Boolean)
                      : []
                  }
                  onChange={setSelected}
                  onSend={send}
                  onSave={() => save()}
                  dirty={dirty}
                  sending={sending}
                  saving={saving}
                  readOnly={readOnly}
                  variables={preview?.variables}
                  isSecret={isSecretVar}
                  introspect={(r) => sendComposed(root, r, envId)}
                />
                <ResizeHandle
                  axis="y"
                  target="prev"
                  min={80}
                  max={() => (split.current?.clientHeight ?? 0) - 160}
                  onResize={(editor) => resize({ editor })}
                  onReset={() => resize({ editor: null })}
                  label="Resize response"
                />
                <ResponsePane
                  response={result?.response ?? null}
                  error={result?.error ?? null}
                  sending={sending}
                  scripts={result?.report ?? EMPTY_REPORT}
                  scriptRunning={!!result?.scriptRunning}
                />
              </div>
            )}
            {defaults && collection && (
              <DefaultsEditor
                title={defaults.path ?? collection.name}
                kind={defaults.path === null ? "Collection" : "Folder"}
                stats={defaultsStats}
                headers={defaults.headers}
                auth={defaults.auth}
                onChange={(headers, auth) =>
                  setDefaults({ ...defaults, headers, auth })
                }
                onSave={() => saveInheritedDefaults()}
                saving={saving}
                readOnly={readOnly}
              />
            )}
            {envFront && collection && (
              <EnvironmentEditor
                ref={envEditor}
                key={envTab.draft.id}
                root={root}
                base={envTab.base}
                draft={envTab.draft}
                onChange={(draft) => setEnvTab({ ...envTab, draft })}
                onSaved={envSaved}
                active={!!envTab.base && envId === envTab.base.id}
                onActiveChange={(on) => pickEnv(on ? envTab.draft.id : null)}
                readOnly={readOnly}
              />
            )}
            {!selected && !defaults && !envFront && (
              <div className="flex flex-1 items-center justify-center text-z-muted [&_.ant-empty-image]:text-z-faint">
                <Empty
                  image={<LuPackage size={48} />}
                  description={
                    collection
                      ? "Pick a Request in the sidebar, or create a new one."
                      : "Add a Collection (a shared Git repository) to get started."
                  }
                >
                  {collection ? (
                    <Button
                      type="primary"
                      icon={<LuPlus />}
                      disabled={readOnly}
                      onClick={() => newRequest()}
                    >
                      New Request
                    </Button>
                  ) : (
                    <Button
                      type="primary"
                      icon={<LuPlus />}
                      onClick={() => setAddOpen(true)}
                    >
                      Add Collection
                    </Button>
                  )}
                </Empty>
              </div>
            )}
          </div>
        </main>

        {rightShown && (
          <ResizeHandle
            axis="x"
            target="next"
            min={280}
            max={640}
            onResize={(r) => resize({ right: r })}
            onReset={() => resize({ right: null })}
            label="Resize right sidebar"
          />
        )}
        {rightShown && (
          <RightSidebar
            view={right.view}
            onViewChange={(view) => changeRight({ ...right, view })}
          >
            {previewError && (
              <Alert
                type="error"
                showIcon
                className="mx-3 mt-2"
                title={<span className={preWrap}>{previewError}</span>}
              />
            )}
            {right.view === "variables" && (
              <VariablesPanel
                root={root}
                preview={preview}
                env={activeEnv}
                readOnly={readOnly}
                onChanged={async () =>
                  setCollection(await openCollection(root))
                }
              />
            )}
            {right.view === "code" && <CodeSnippetPanel preview={preview} />}
          </RightSidebar>
        )}
      </div>

      <StatusBar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        rightOpen={right.open}
        onToggleRight={
          !!selected && !defaults
            ? () => changeRight({ ...right, open: !right.open })
            : null
        }
        syncing={!!root}
        syncFailure={syncFailure}
        queued={offline.status.queued.length}
        envName={
          (envId &&
            collection?.environments.find((e) => e.id === envId)?.name) ||
          null
        }
        onOpenSettings={() => setSettings("general")}
      />

      <SettingsModal
        section={settings}
        onSection={setSettings}
        onClose={() => setSettings(null)}
        zoom={zoom}
        root={root}
        refreshKey={sendCount}
        path={path}
        onPathChange={setPath}
        onOpen={open}
      />

      {closing.length > 0 && (
        <UnsavedTabDialog
          key={closing[0].id}
          item={closing[0]}
          saving={saving}
          readOnly={readOnly}
          onSave={() => saveAndClose(closing[0])}
          onDiscard={(always) => {
            if (always) setDiscardOnClose(true);
            const ids = (always ? closing : closing.slice(0, 1)).map(
              (r) => r.id,
            );
            setClosing((q) => (always ? [] : q.slice(1)));
            discardAndClose(ids, ids);
          }}
          onCancel={() => setClosing([])}
        />
      )}
      {saveAs && collection && (
        <SaveRequestDialog
          item={saveAs.item}
          collection={collection}
          onSave={(name, folder) => saveAs.resolve({ name, folder })}
          onCancel={() => saveAs.resolve(null)}
        />
      )}
      {selected && conflict && conflict.change.kind !== "create" && (
        <ConflictDialog
          mine={selected}
          info={conflict.info}
          busy={resolving}
          onOverwrite={() => resolveConflict(true)}
          onCancel={() => resolveConflict(false)}
        />
      )}
    </div>
  );
}
