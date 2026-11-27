# UI conventions (frontend in `src/`)

Read this before touching any `.tsx` or `.css` file.

**Styling is Tailwind CSS v4** (`@tailwindcss/vite`), class names in the components. `styles/globals.css` keeps only the Tailwind setup and what has to be plain CSS (see "Styling with Tailwind").

## The look: Postman-style shell

The layout copies the structure of Postman's desktop app, not its branding (no Postman logo, name or artwork):

```
┌ topbar: brand / open Collection ─── search Requests ─── theme · settings ┐
├ banners (Alert banner: read-only, sync failure, offline, Needs Attention) ┤
│ sidebar                  │ tab bar: open Requests ······ Environment │ right  │
│  rail: Collections /     │ breadcrumb ························· Save │ bar:   │
│        Environments /    │ [METHOD][ URL ................ ][ Send ] │ Vari-  │
│        History           │ Params · Authorization · Headers · Body  │ ables /│
│  filter + new req/folder │───────────────────────────────────────── │ Code   │
│  Collection tree         │ Response: status · time · size, Body ... │ snippet│
├ status bar: sidebar toggle · sync status · queued ···· Settings · right toggle ┤
```

- Windows and Linux have no native title bar (`decorations: false` in `src-tauri/tauri.windows.conf.json` / `tauri.linux.conf.json`, which repeat the whole window entry of `tauri.conf.json`: keep them in step) and no app menu, so `WorkspaceHeader` draws a title bar row above the top bar: `AppMenu` (File / Edit / View / Help, same commands as `menu.rs`) on the left, `WindowControls` (Minimize, Maximize / Restore, Close via `service/window`) on the right. Empty space in the row is a `data-tauri-drag-region` (drag moves the window, double-click maximizes). `hasAppMenu` (`libs/keys`) switches it. To see it on macOS: `VITE_FAKE_WINDOWS=1 pnpm tauri dev`.
- Right sidebar (`RightSidebar`): works like the left one: a view rail on top, shown or hidden entirely from the status bar toggle (bottom right), only while a Request is open. Views: Variables (variables the Request uses, resolved, then all variables; values of the active Environment are edited in place: shared ones through `saveEnvironment`, Secrets through `setSecretValue` (this machine only), a missing one is added to the Environment) and Code snippet (cURL, HTTP, Fetch, Axios, Python, Go, Java, C#, PHP, Dart, Swift, Ruby, PowerShell, Rust; language + indent / trim body / follow redirects remembered in `libs/prefs`). Both read `preview_request` (compose without sending) through `useRequestPreview`, which also runs while the sidebar is hidden: the URL bar uses its variables. Shown/hidden and the view are remembered in `libs/prefs`.
- Sidebar headers: Collections and Environments look the same (bold title, then `New` and `Import` buttons on the right, outside the scrolling list). The Environments `New` opens a new Environment tab; its `Import` is the same `ImportMenu`. The Environments view only lists Environments: Secret values are filled in each Environment's tab, never read for the list (reading every Secret on open is what used to trigger the macOS Keychain prompt).
- Sidebar toolbar (under the Collections header): filter, New Request, New Folder, Fetch changes (`LuRefreshCw`). Fetch runs the auto-sync fetch at once (`useAutoSync().syncNow`), spins with Ant's `loading` on the `IconButton` while it runs, and shows its error at once (the background fetch only reports after several failures).
- Tree actions: every tree change (new Request, Duplicate, new Folder, Rename, Delete, drag and drop) shows at once and saves in the background through `saveInBackground` in `TreeSidebar`: one commit and one push per action (`saveBatch` → `CollectionService::save_batch`), actions queued one after another, and **no spinner** on the rows (an exception to the Loading rule below, asked for so the tree feels instant). A new Request / Duplicate is added to the loaded Collection and opened (`onAdded`); a new Folder shows at once but has no menu, drag or drop until saved. A failed or conflicting save shows an error and reloads the tree, which shows the real state.
- Tree drag and drop (`TreeSidebar`): a line above / below a Request row puts the dragged Requests before / after it; on a Folder row the top / bottom quarter puts dragged Folders before / after it (not the bottom of an open Folder) and the rest drops into it (dashed outline); empty tree space drops at the Collection root. A drop shows the rows in their new place at once (`moves` over the loaded Collection, `withMoves`); saved in the background with no spinner (the one exception to the Loading rule: the person asked for drag and drop to feel instant), as **one commit and one push per drop** (`saveBatch` → `CollectionService::save_batch`), one drop after another; a change the remote no longer allows is left out and named in an error, and the reload shows the real tree. Requests and Folders keep separate orders (Folders always list first). The Tauri window has `dragDropEnabled: false`: Tauri's file-drop handler otherwise swallows HTML5 drag events in the webview.
- Export to Postman (`exportToPostman` in `WorkspacePage`): first `exportTokenWarnings` scans the whole Collection (Request headers, body and auth, Folder and Collection headers and auth; disabled headers too, the file carries them) for hard-coded credentials. Any found are listed in a confirm (place "Folder / Request" + what: header, body, auth); a click on one closes it and opens that Request (or the Folder / Collection Headers & auth) to switch to a `{{variable}}`; "Export anyway" goes on.
- Tree multi-selection (`TreeSidebar`), like Finder / VS Code: ⌘-click (Ctrl on Windows / Linux) toggles a row, Shift-click picks the range of shown rows from the last clicked row (or the open Request); picked rows use `treeRow({ picked })`. Right-click a picked row → "Delete N items"; right-click any other row → its "…" menu. Dragging a picked row moves all of them, under an "N items" drag chip. Items inside a picked Folder go with it. Every tree Delete ("Delete N items", and a single row's "…" / right-click Delete) hides the rows as soon as it is confirmed and saves them the same way, in one commit (`deleteInBackground`). Esc clears the selection, Delete / ⌘⌫ deletes it; changing the filter clears it.
- Breadcrumb above the URL bar: clicking the Request name (or Enter / F2 on it) edits it in place; Enter or blur keeps it, Esc cancels. It changes the draft like any edit and is shared on Save. Not offered on a read-only Collection.
- Resizing: both sidebars' widths and the Request editor / Response split are dragged with `ResizeHandle` (double-click resets, arrow keys work); sizes are remembered in `libs/prefs` (`zenar.layout`) and applied as CSS variables (`--sidebar-w`, `--right-w`, `--editor-h`) read by arbitrary-value classes (`w-[var(--sidebar-w,320px)]`). Once the split is dragged (`is-sized` on the `group/split` wrapper), the Request tabs fill the editor height and the Body / Scripts `CodeEditor` stretches with it (`group-[.is-sized]/split:` classes).
- Shortcuts (`useShortcuts`) use Postman's keys: tabs ⌘T new, ⇧⌘T reopen closed, ⌘W / ⌥⌘W close, ⇧⌘] / ⇧⌘[ next / previous, ⌘1–⌘8 / ⌘9 tab at position / last; Request ⌘S save, ⌘↵ send, ⌘L URL bar; ⌘K search, ⌘\ sidebar, ⌘, Settings, ⌘/ Shortcuts, ⌘= / ⌘- / ⌘0 zoom, ⇧⌘W close window, full screen ⌃⌘F (F11 on Windows / Linux) (Ctrl on Windows / Linux). On macOS most are app-menu items (`src-tauri/src/menu.rs`) that reach the UI as `menu` events (`IN_MAC_MENU` in the hook); the hook catches the rest, and every key elsewhere. A new shortcut needs a `MenuCommand`, a key in `commandFor`, a label in `libs/keys` `SHORTCUTS`, a row in `ShortcutList` and, when it has a menu home, the same item in both `menu.rs` (macOS) and `AppMenu` (Windows / Linux): the two menus list the same items with the same keys, Help is Keyboard Shortcuts · About Zenar everywhere; only the platform's own places differ (macOS: Settings / Quit (and the native About panel) in the Zenar menu; Windows / Linux: Settings / Exit in File). Zoom is the webview's (`service/view`, permission `core:webview:allow-set-webview-zoom`), remembered in `libs/prefs`.
- The shell pieces are in `components/workspace/`; `components/pages/workspace/WorkspacePage.tsx` puts them together and owns the state (see "Where code goes").
- Text selection: interface text (tabs, buttons, labels) is not selectable, like a desktop app (`body { user-select: none }`). Inputs and textareas opt back in (in `globals.css`); content people copy (response body, header values, error text) gets the `select-text` class, which also writes the `-webkit-` prefix the macOS webview (WebKit) needs. Gutters such as line numbers are CSS `content` (`data-ln` + `before:content-[attr(data-ln)]`) so they are never selected or copied.
- Loading: any action that waits on git or the network (add / open a Collection, Save, sync, import) must show a visible, **spinning** indicator for its whole duration, in every dialog it passes through (a Modal that closes before the work ends hides the spinner: keep it open). Use Ant's built-in loading, never a hand-written spinner or extra CSS: `loading` on `Button` / the Modal's `okButtonProps` (text "Opening...", "Saving..."), `Spin` for panes. Tree rows never show a spinner (see Tree actions). While busy also disable the inputs, Cancel, X, Esc and mask-click, and ignore Enter, so it cannot be submitted twice or dismissed mid-way. Never disable motion for spinners: `prefers-reduced-motion` in `globals.css` turns off transitions only, never `animation`. After a change, check that the spinner really turns (a static icon counts as a bug).
- Toasts: short confirmations ("Copied", "Zenar is up to date.") use Ant's `message` from `AntApp.useApp()`, never a hand-made toast. They show at the bottom right above the status bar; Ant v6 has no placement option for `message`, so `globals.css` moves it (`.ant-message-top` rules).
- Keep it dense: 13px base font, 28px tree rows, 30px controls, small paddings.
- Tree indentation: every level (Collection → Folder → sub-Folder / Request) steps by the same `--tree-indent` (12px, on the `WorkspaceSidebar` aside). Rows use `treeRow()` from `@/components/ui` and set only their level, `style={{ "--depth": n }}`; never hard-code a `paddingLeft`.
- A Send failure (no response at all: connection refused, bad URL, TLS...) shows in the Response pane (`ResponsePane` `error`), like Postman's "Could not send request". It never goes to the top error alert. The backend message names the cause (`zenar-http` `describe`).
- Each open tab keeps its last Send (response, Send error, script report) in `WorkspacePage` `results`, by Request id, like Postman: switching tabs, opening the Environment / Defaults tab or hiding a sidebar never clears it. Closing the tab drops it, so does opening or closing a Collection; it is memory only, so quitting the app clears every one. A Send that is still running when its tab goes to the back lands in that tab (`sendingIds`), not the one in front.
- Put a new view in the slot where Postman puts it. A sidebar list goes in a sidebar rail view, an open item gets a tab, a per-machine option goes in a section of the Settings popup (`SettingsModal`, laid out like Postman's: section menu on the left, `SettingSection` + `SettingRow` lines on the right), and an app-wide warning becomes an `Alert banner` in the banners strip under the topbar (`WorkspacePage`).

## Where code goes

Always import through the `@/` alias (`@/*` → `src/*`, set in `tsconfig.json` and `vite.config.ts`) and through each folder's `index.ts` barrel, not deep file paths.

```
src/
  main.tsx                 React root, loads styles/globals.css
  App.tsx                  providers + WorkspacePage, nothing else
  bindings/                GENERATED by ts-rs from Rust (#[ts(export_to = ".../src/bindings/")]). Never edit or move.
  components/
    providers/             ThemeProvider (+ useTheme), AntdProvider (ConfigProvider + antd App)
    ui/                    small reusable pieces: styles.ts (shared Tailwind class strings: treeRow, rowMenuButton, fieldLabel, requestTabs...), KvTable + KvRow (key/value grid tables), CodeView (read-only code, line numbers, token colours in TOKEN_CLASS), EllipsisText (one-line name cut with "…", tooltip with the full text only when cut), IconButton, MethodTag, ResizeHandle (drag handle between panes), SectionTitle, TabCount, ThemeSwitcher
    workspace/             app shell: WorkspaceHeader, WorkspaceSidebar (rail), RequestTabs, RightSidebar, StatusBar
    pages/workspace/       WorkspacePage (state + Save/sync/conflict flow) and one folder per feature:
      collections/         CollectionManager, TreeSidebar, NewMenu, ImportMenu (Import dropdown: Postman collection, or environment files into ImportEnvironmentDialog. A Postman collection lands in a new Folder named after it; a Zenar export imported back into its own Collection, found by the ids the export writes, updates its Requests in place instead)
      request/             RequestEditor, ScriptsEditor (Scripts tab: Before request / After response, JavaScript), BodyEditor (none / form-data / x-www-form-urlencoded / raw + language / binary / GraphQL, Beautify), FormDataBody, BinaryBody, CapturesEditor (Captures tab: Variable / JSONPath / Description table like KeyValueEditor, empty last row adds one, trash on hover), CodeEditor (textarea over a coloured layer, line numbers; `variables` colours `{{variables}}` in request bodies), VarInput (one-line field colouring `{{variables}}` blue when they have a value, red when not: coloured layer over a transparent input; used for every Request field that is substituted: Params, Headers, Auth, form fields), has-variable (`HasVariable` context, provided by RequestEditor; no provider = every variable known), UrlInput (URL bar on VarInput, also colours `:path` segments), ParamsEditor (Query Params + Path Variables), KeyValueEditor (Postman-style table: Description in `extra.description`, empty last row adds a row, trash on hover, Bulk Edit), AuthEditor, DefaultsEditor, ConflictDialog, GonePrompt
      response/            ResponsePane (status line, Body / Cookies / Headers / Test Results / Console), TestResults, ScriptConsole, ResponseBody (view picker: JSON / XML / HTML / YAML / JavaScript / Markdown / Raw / Hex / Base64; preview, wrap, search, copy), MarkdownPreview (Markdown rendered with `marked` in the app window and theme: raw HTML shown as text, only http(s) / mailto links (they never navigate), code blocks with language + Copy), JsonPreview (Preview of JSON as nested key/value tables), TreePreview (Preview of XML / YAML like Postman: "Root › element" breadcrumb over collapsed tables, via `xmlToJson` / `yamlToJson` (`yaml` package)), ResponseCookies
      context/             right sidebar views: VariablesPanel, CodeSnippetPanel
      environments/        EnvironmentsPanel (sidebar list: a click opens the Environment as a tab, it never makes it active; "…" / right-click → Rename (in place: Enter keeps, Esc / blur cancels), Duplicate ("<name> (copy)" right after it, opened once saved; this person's Secret values are copied to it), Export, Delete (shared for every Member, also deletes this machine's Secrets for it); drag a row onto the top / bottom half of another to reorder (a new shared `order`, `orderBetween`). All show at once and save in the background one after another, like tree actions; a copy not saved yet has no menu or drag), EnvironmentEditor (that tab: name, "active" checkbox, Variable / Value table with Secret lock and trash on hover, empty last row adds a variable; Secret values are this machine's, loaded with `getSecretValues` when the tab opens, masked with an eye to show them; Save stores a changed one, an emptied one is deleted), ImportEnvironmentDialog (preview of an environment file import: target Environment, Secrets filled, values replaced, skipped variables). A row's "…" menu exports the Environment with this person's Secret values
      local/               HistoryPanel
      settings/            SettingsModal (Postman-style popup): GeneralSettings, ThemeSettings (mode cards + zoom), ShortcutList, SettingRow / SettingSection
      sync/                OfflineNotices
  service/<domain>/        Tauri commands, one folder per domain: <domain>.api.ts + index.ts
    collection/            open, Save, Folders, Drafts, Conflicts, offline queue, sync, import
    library/               cloned Collections on this machine, commit author
    environment/           Environments, Secrets, token warnings
    runner/                send Requests (sendScripted: pre-request script → Send → post-response script; `zn.environment` writes go to the active Environment through saveEnvironment / setSecretValue, other scopes to Captured Variables), run options, Captured Variables, history
    files/                 native file picker (Tauri dialog plugin)
    menu/                  tab commands from the macOS app menu (src-tauri/src/menu.rs)
  hooks/                   use-*.ts (kebab-case files, camelCase exports): use-auto-sync, use-offline-queue, use-shortcuts (⌘T / ⌘S / ⌘W / ⌥⌘W / zoom), use-zoom, use-request-preview
  libs/                    pure helpers, no React: cx (join conditional class names), theme palettes, order (orderBetween), format, http (status text, Set-Cookie), body-format (detect, pretty-print XML / HTML and tokenize response bodies), session (last open Collection + its tabs, in localStorage["zenar.session"]), prefs (per-machine UI options), snippets (Code snippet generators per language + colouring), keys (shortcut labels per platform), url-params (URL bar ↔ Params / Path Variables sync), key-value (row description, Bulk Edit text), scripts (runScript: one script in a throwaway Web Worker, 10 s timeout) + script-sandbox (the `zn` API, `pm` as alias) + script-worker (worker entry)
  styles/globals.css       Tailwind setup (layers, @theme tokens) + the few rules that must be plain CSS
```

Rules:
- One component per file, PascalCase file named after the component. Hooks are `hooks/use-<name>.ts`.
- Request scripts (code from a shared Collection) only run inside the script Web Worker (`libs/scripts`), never in the window: the worker has no Tauri IPC. A new `zn` feature goes in `libs/script-sandbox.ts`.
- Components never call `invoke` directly; they call a `service/<domain>` function. A new Tauri command gets a function in the matching `<domain>.api.ts` (or a new `service/<domain>/` folder with `index.ts`).
- Types for Tauri data come from `@/bindings/...`. Hand-written types that only the UI needs go next to their service (e.g. `Author` in `service/library`).
- A new feature screen or panel gets a folder in `components/pages/workspace/<feature>/` with an `index.ts`. A piece used by two features or more moves to `components/ui/`.
- Unlike web-ui, there is no `app/` router (this is one Tauri window, not Next.js) and no React Query: the service functions are plain async calls.

## Libraries: required

- **Components: Ant Design (`antd`, v6).** Use Ant for every control: Button, Input, Select, Tabs, Modal, Drawer, Dropdown, Alert, Tooltip, Checkbox, Radio, AutoComplete, Empty, Tag. Don't use raw `<button>`/`<input>`/`<select>` for controls. The only exceptions are the tiny row/tab buttons (`rowMenuButton`, the tab close button in `RequestTabs`, the status bar Settings link).
  - Use the v6 prop names: `Alert title` (not `message`), `closable={{ onClose }}`, `Tag variant="filled"` (not `bordered`), `Space orientation` (not `direction`). Check the console for `[antd: ...] deprecated` warnings and fix them.
  - For dialogs, toasts and confirms, use `const { modal, message } = App.useApp()`. `await modal.confirm({...})` resolves to `true`/`false`. Never use `window.confirm`/`alert`; they block the Tauri webview.
- **Icons: `react-icons`, Lucide set only (`react-icons/lu`)**, e.g. `import { LuSend } from "react-icons/lu"`. Don't mix in other icon sets, `@ant-design/icons`, or emoji. Before using a name, check it exists with `grep -w LuName node_modules/react-icons/lu/index.d.ts`.
- Icon-only buttons go through `IconButton` in `@/components/ui`, which adds the tooltip and `aria-label`. HTTP methods are shown with `MethodTag`.

## Light / dark mode: required

- `src/libs/theme.ts` holds **one palette per mode**. It feeds both the Ant `ConfigProvider` tokens (`antdThemeFor`) and the `--z-*` CSS variables (`applyCssVars`). `App.tsx` wraps the page in `ThemeProvider` + `AntdProvider` (`components/providers/`).
- The mode is Light / Dark / System. It is stored in `localStorage["zenar.theme"]` and switched from the topbar (`ThemeSwitcher`) or Settings → Themes. Use `useTheme()` from `@/components/providers` to read or change it; the topbar control is `ThemeSwitcher`.
- **Never hard-code a colour** in classes, `styles/globals.css` or inline styles. Use the palette classes (`bg-z-bg`, `text-z-muted`, `border-z-border`, `text-z-get`, `bg-z-delete/14`...); Tailwind's own colours are removed in `globals.css`, so `text-red-500` does not exist. A new colour gets a key in **both** palettes in `libs/theme.ts`, a `--z-` variable in `applyCssVars`, and a `--color-z-*` line in the `@theme inline` block of `globals.css`.
- Text must keep at least 4.5:1 contrast in both modes. Method colours are darker in light mode for this reason.
- Syntax colours of response bodies are palette keys too (`code*` → `--z-code-*` → `text-z-code-*`, mapped per token kind in `TOKEN_CLASS` in `CodeView`). Don't add a highlighter or code-editor library; `CodeEditor` and `CodeView` share the tokenizers in `libs/body-format.ts`.
- Body types stored in `body_type`: null, `formdata` (fields in `body_extra.fields`), `form` (x-www-form-urlencoded), `binary` (path in `body_extra.file`), `graphql` (query in `body`, variables in `body_extra.variables`), or a raw language `json` / `text` / `javascript` / `html` / `xml` (legacy `raw` = no Content-Type). Read and write `body_extra` only through `libs/request-body.ts` (mirrors `RequestItem::form_fields` & co. in zenar-format). The backend sets the matching Content-Type (`zenar-http` compose). Offer a body mode in the UI only when the backend can send it.
- Native file pickers go through `service/files` (`pickFile`, Tauri dialog plugin, permission `dialog:allow-open`). File paths are per machine: say so next to any field that stores one.
- Check every UI change in both modes.

## Checking a UI change

1. `pnpm exec tsc --noEmit` must pass.
2. Run `pnpm tauri dev` (the window hot-reloads), or open `http://localhost:1420` in a browser. In a plain browser there is no Tauri backend. To see real screens, set `window.__TAURI_INTERNALS__ = { invoke: async (cmd, args) => ... }` with fake data, replace `#root`, then `import("/src/main.tsx?x=" + Date.now())`. Do this only in the browser; never commit a mock.
3. Look at it in light and dark mode, and check the console for antd warnings.

## Don't

- Don't change behaviour while restyling. Save/merge/conflict/offline logic in `WorkspacePage.tsx` and the feature panels is domain logic (see `GLOSSARY.md`); move it, don't rewrite it.
- Don't add another UI kit, CSS framework or icon set (Tailwind is the one CSS framework).
- Don't write new CSS classes in `globals.css` for a component; use Tailwind classes (see below).
- Don't load web fonts or other remote assets; the app must work offline. Use the system font stacks in `libs/theme.ts`.

## Styling with Tailwind

- Tailwind v4, no `tailwind.config`: the setup is in `styles/globals.css`. **No preflight** (Ant and the browser defaults stay as they were): `<p>`, headings and lists keep their default margins, so set `m-0` / `mt-*` where needed.
- Layers, lowest first: `theme, base, antd, components, utilities`. Ant's CSS-in-JS goes in `@layer antd` (`StyleProvider layer` in `AntdProvider`), so a utility on an Ant component beats Ant's own style without `!`. Use `!` only against Ant's inline styles (e.g. Menu item padding).
- Theme tokens: palette colours `z-*` (and `p-*` for the theme preview cards), fonts `font-sans` / `font-mono`, sizes `text-2xs` 10px, `text-xs` 11px, `text-sm` 12px, `text-code` 12.5px (mono), `text-base` 13px, `text-md` 14px, `text-lg` 20px, `text-xl` 24px. Spacing is Tailwind's 4px scale; odd values use brackets (`px-[11px]`).
- Join conditional classes with `cx` from `@/libs/cx`. Never pick between two classes for the same property by listing both (`text-z-muted` + `text-z-primary`): which wins depends on CSS order, not class order. Choose one in code.
- A class string used by two features goes in `components/ui/styles.ts`; markup used twice becomes a component (`KvTable`, `IconButton`). Classes used only inside one feature folder may sit in a small `styles.ts` there (`context/styles.ts`).
- Ant internals without a className hook: prefer the component's `classNames` prop (v6 semantic slots, e.g. Modal `classNames={{ container, close }}`); otherwise an arbitrary variant on the owner (`[&_.ant-tabs-nav]:mb-2`).
- Plain CSS stays in `globals.css` only when Tailwind can't express it: `html` / `body` / `*` base rules, global `::-webkit-scrollbar` styling, `:focus-visible`, the `body.is-resizing-*` states set from script, and `prefers-reduced-motion`.

