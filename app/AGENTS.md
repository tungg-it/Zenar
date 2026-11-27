## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`gh` CLI). Pull requests are not accepted. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.

### UI conventions

Postman-style layout, **Ant Design** components, **`react-icons/lu`** (Lucide) icons only, and light/dark mode through `src/libs/theme.ts` (no hard-coded colours). Folder layout: `components/`, `service/<domain>/`, `hooks/`, `libs/`, `@/` alias. Read `docs/agents/ui.md` before any frontend change.
