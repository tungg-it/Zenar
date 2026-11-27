import { useEffect, useState, type ReactNode } from "react";
import { Alert, App as AntApp, Button, Dropdown, Input, Modal, type MenuProps } from "antd";
import { LuChevronDown, LuChevronRight, LuEllipsis, LuExternalLink, LuGitBranch, LuTrash2 } from "react-icons/lu";
import { addCollection, AUTHOR_REQUIRED, authorMissing, listCollections, openCollectionById, openInBrowser, removeCollection, setAuthor } from "@/service/library";
import type { CollectionData } from "@/bindings/CollectionData";
import { EllipsisText, fieldLabel, rowMenuButton, sidebarAlert, treeChevron, treeName, treeRow } from "@/components/ui";
import { cx } from "@/libs/cx";
import type { LibraryEntry } from "@/bindings/LibraryEntry";
import { forgetTabs, lastCollectionId, rememberCollection } from "@/libs/session";

type Props = {
  onOpened: (data: CollectionData, rootPath: string) => void;
  onClosed: () => void;
  /** Clicking the open Collection's name (shows its overview). */
  onActiveClick: () => void;
  /** Extra menu items for the open Collection (add request, headers & auth, import...). */
  activeMenu: MenuProps["items"];
  /** The open Collection's tree, rendered under its row. */
  children: ReactNode;
  /** Open the "Add Collection" dialog (owned here, triggered from the sidebar toolbar too). */
  addOpen: boolean;
  setAddOpen: (open: boolean) => void;
  /** A Collection is open already: this list was remounted, not launched, so nothing is reopened. */
  isOpen: boolean;
};

/** Sidebar Collections list: cloned Collections, the open one expanded; add / open in browser / remove. */
export function CollectionManager({ onOpened, onClosed, onActiveClick, activeMenu, children, addOpen, setAddOpen, isOpen }: Props) {
  const { modal } = AntApp.useApp();
  const [items, setItems] = useState<LibraryEntry[]>([]);
  // Remounted with a Collection open (sidebar hidden and shown, or its view switched): the remembered one.
  const [activeId, setActiveId] = useState<string | null>(() => (isOpen ? lastCollectionId() : null));
  const [collapsed, setCollapsed] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Commit author (name + email) asked once per Collection when git has none, so the first Save works.
  const [needAuthor, setNeedAuthor] = useState<{ then: "add" | LibraryEntry } | null>(null);
  const [author, setAuthorForm] = useState({ name: "", email: "" });

  const refresh = async () => setItems(await listCollections());

  // On launch, reopen the Collection that was open when the app was closed.
  useEffect(() => {
    listCollections()
      .then((l) => {
        setItems(l);
        // Reopening on every mount would reset the open Collection's tabs and cached responses.
        if (isOpen) return;
        const last = l.find((c) => c.id === lastCollectionId());
        if (last) return select(last);
      })
      .catch((e) => setError(String(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // True once the Collection is open (a Modal waiting on it stays open, spinning, until then).
  async function select(c: LibraryEntry): Promise<boolean> {
    setError(null);
    try {
      if (await authorMissing(c.id)) {
        setNeedAuthor({ then: c });
        return false;
      }
      onOpened(await openCollectionById(c.id), c.path);
      setActiveId(c.id);
      rememberCollection(c.id);
      setCollapsed(false);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }

  async function submitAuthor() {
    const target = needAuthor?.then;
    if (!target) return;
    // The Modal stays open, spinning, until the work is done.
    if (target === "add") return add(author);
    setBusy(true);
    try {
      await setAuthor(target.id, author);
      if (await select(target)) {
        setNeedAuthor(null);
        setAddOpen(false);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function add(withAuthor: { name: string; email: string } | null = null) {
    setError(null);
    setBusy(true);
    try {
      const entry = await addCollection(url.trim(), withAuthor);
      await refresh();
      if (await select(entry)) {
        setUrl("");
        setAddOpen(false);
        setNeedAuthor(null);
      }
    } catch (e) {
      if (String(e) === AUTHOR_REQUIRED) setNeedAuthor({ then: "add" });
      else {
        setNeedAuthor(null);
        setError(String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: LibraryEntry) {
    setError(null);
    const ok = await modal.confirm({
      title: `Remove "${c.name}" from this machine?`,
      content: "Its Drafts and Secrets here are deleted. Your Git credentials are not affected.",
      okText: "Remove",
      okButtonProps: { danger: true },
    });
    if (!ok) return;
    try {
      let r = await removeCollection(c.id, false);
      if (!r.removed) {
        const sure = await modal.confirm({
          title: "Unshared Saves will be lost",
          content: `${r.unpushed} Save(s) in "${c.name}" exist only on this machine and will be lost. Remove anyway?`,
          okText: "Remove anyway",
          okButtonProps: { danger: true },
        });
        if (!sure) return;
        r = await removeCollection(c.id, true);
      }
      forgetTabs(c.path);
      if (activeId === c.id) {
        setActiveId(null);
        rememberCollection(null);
        onClosed();
      }
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div>
      {error && <Alert type="error" title={error} closable={{ onClose: () => setError(null) }} className={sidebarAlert} />}
      {items.map((c) => {
        const active = activeId === c.id;
        const menu: MenuProps["items"] = [
          ...(active && activeMenu?.length ? [...activeMenu, { type: "divider" as const }] : []),
          { key: "web", icon: <LuExternalLink />, label: "Open repo in browser (add Members there)", onClick: () => openInBrowser(c.id).catch((e) => setError(String(e))) },
          { key: "remove", icon: <LuTrash2 />, label: "Remove from this machine", danger: true, onClick: () => remove(c) },
        ];
        return (
          <div key={c.id}>
            <div
              className={cx(treeRow(), "font-medium")}
              onClick={() => {
                if (!active) return select(c);
                setCollapsed(!collapsed);
                onActiveClick();
              }}
            >
              <span className={treeChevron}>{active && !collapsed ? <LuChevronDown /> : <LuChevronRight />}</span>
              <EllipsisText className={treeName} text={c.name} placement="right" />
              <Dropdown menu={{ items: menu, onClick: (e) => e.domEvent.stopPropagation() }} trigger={["click"]}>
                <button className={rowMenuButton} aria-label={`More actions for ${c.name}`} onClick={(e) => e.stopPropagation()}>
                  <LuEllipsis />
                </button>
              </Dropdown>
            </div>
            {active && !collapsed && children}
          </div>
        );
      })}
      {items.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-z-muted">
          <LuGitBranch size={28} />
          <p>No Collections yet. A Collection is a Git repository shared with your team.</p>
          <Button type="primary" onClick={() => setAddOpen(true)}>
            Add Collection
          </Button>
        </div>
      )}

      <Modal
        title="Add a Collection"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => add()}
        okText={busy ? "Opening..." : "Add"}
        okButtonProps={{ disabled: !url.trim(), loading: busy }}
        cancelButtonProps={{ disabled: busy }}
        closable={!busy}
        maskClosable={!busy}
        keyboard={!busy}
      >
        <label className={fieldLabel} htmlFor="repo-url">
          Repository HTTPS URL
        </label>
        <Input
          id="repo-url"
          className="font-mono text-code"
          placeholder="https://gitlab.com/team/api-collection.git"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onPressEnter={() => url.trim() && !busy && add()}
          disabled={busy}
          autoFocus
        />
        <p className={cx(fieldLabel, "mt-4")}>
          Need a new Collection?
        </p>
        <ol className="pl-[18px] leading-[1.7] text-z-muted">
          <li>On your Git host (GitHub, GitLab, ...) create a new repository.</li>
          <li>Leave it completely empty: no README, no .gitignore, no license.</li>
          <li>Copy its HTTPS URL (starts with https://) and paste it above.</li>
          <li>After it opens, use "Open repo in browser" to add Members on the host.</li>
        </ol>
        {error && <Alert type="error" title={error} />}
      </Modal>

      <Modal
        title="Who are you?"
        open={!!needAuthor}
        onCancel={() => setNeedAuthor(null)}
        onOk={submitAuthor}
        okText={busy ? "Opening..." : "Continue"}
        okButtonProps={{ disabled: !author.name.trim() || !author.email.trim(), loading: busy }}
        cancelButtonProps={{ disabled: busy }}
        closable={!busy}
        maskClosable={!busy}
        keyboard={!busy}
      >
        <p className="text-z-muted">Your name and email are recorded with every Save you share. They are kept for this Collection only.</p>
        <label className={fieldLabel} htmlFor="author-name">
          Name
        </label>
        <Input id="author-name" value={author.name} onChange={(e) => setAuthorForm({ ...author, name: e.target.value })} disabled={busy} autoFocus />
        <label className={cx(fieldLabel, "mt-3")} htmlFor="author-email">
          Email
        </label>
        <Input id="author-email" type="email" value={author.email} onChange={(e) => setAuthorForm({ ...author, email: e.target.value })} disabled={busy} />
      </Modal>
    </div>
  );
}
