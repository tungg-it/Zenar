import { useEffect, useState } from "react";
import { Alert, App as AntApp, Modal, Select, Tag } from "antd";
import { LuKeyRound, LuLayers } from "react-icons/lu";
import { applyEnvironmentImport, planEnvironmentImport, saveEnvironment } from "@/service/environment";
import { openCollection } from "@/service/collection";
import type { CollectionData } from "@/bindings/CollectionData";
import type { EnvImportPlan } from "@/bindings/EnvImportPlan";
import type { SkipReason } from "@/bindings/SkipReason";
import type { TargetChoice } from "@/bindings/TargetChoice";
import { fieldLabel } from "@/components/ui";

export type EnvironmentFile = { name: string; text: string };

type Entry = EnvironmentFile & { plan?: EnvImportPlan; error?: string };

const NEW = "__new__";

const SKIP_TEXT: Record<SkipReason, string> = {
  shared: "shared value, comes from the Collection",
  not_in_environment: "not in this Environment",
  disabled: "disabled in the file",
  no_value: "no value in the file",
};

type Props = {
  root: string;
  collection: CollectionData;
  /** Files picked to import; null when the dialog is closed. */
  files: EnvironmentFile[] | null;
  /** This machine cannot Save (Viewer or read-only Collection): only existing Environments can be filled. */
  cannotSave: boolean;
  onClose: () => void;
  onImported: (c: CollectionData) => void;
};

/**
 * Preview, then import environment files. A file matching an Environment fills this person's
 * Secrets (this machine only, no Save); any other file becomes a new Environment Saved for every Member.
 */
export function ImportEnvironmentDialog({ root, collection, files, cannotSave, onClose, onImported }: Props) {
  const { message } = AntApp.useApp();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);

  const plan = (f: EnvironmentFile, choice: TargetChoice): Promise<Entry> =>
    planEnvironmentImport(root, f.text, f.name, choice).then(
      (p) => ({ ...f, plan: p }),
      (e) => ({ ...f, error: String(e) }),
    );

  useEffect(() => {
    if (!files) return setEntries([]);
    Promise.all(files.map((f) => plan(f, { kind: "auto" }))).then(setEntries);
  }, [files]); // eslint-disable-line react-hooks/exhaustive-deps

  async function retarget(i: number, value: string) {
    const choice: TargetChoice = value === NEW ? { kind: "new" } : { kind: "existing", environment_id: value };
    const next = await plan(entries[i], choice);
    setEntries((es) => es.map((e, j) => (j === i ? next : e)));
  }

  const blocked = (e: Entry) => !e.plan || (e.plan.target.kind === "new" && cannotSave);
  const ready = entries.filter((e) => !blocked(e));

  async function run() {
    setBusy(true);
    try {
      let filled = 0;
      let created = 0;
      for (const { plan: p } of ready) {
        if (!p) continue;
        if (p.target.kind === "existing") {
          await applyEnvironmentImport(root, p);
          filled += p.fills.length;
        } else {
          const r = await saveEnvironment(root, null, p.target.environment);
          if (r.status !== "saved") throw new Error(`"${p.target.environment.name}" was not saved: another Member changed it`);
          created += 1;
        }
      }
      onImported(await openCollection(root));
      const parts = [
        created && `${created} Environment${created === 1 ? "" : "s"} created`,
        filled && `${filled} Secret${filled === 1 ? "" : "s"} filled`,
      ].filter(Boolean);
      message.success(parts.length ? parts.join(", ") : "Nothing to import");
      onClose();
    } catch (e) {
      message.error(String(e), 8);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!files}
      title="Import Environment"
      okText={busy ? "Importing..." : "Import"}
      okButtonProps={{ loading: busy, disabled: ready.length === 0 }}
      cancelButtonProps={{ disabled: busy }}
      onOk={run}
      onCancel={() => !busy && onClose()}
      closable={!busy}
      maskClosable={!busy}
      keyboard={!busy}
      width={560}
      destroyOnHidden
    >
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-auto">
        {entries.map((e, i) => (
          <section key={`${e.name}-${i}`} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <LuLayers className="shrink-0 text-z-muted" />
              <span className="min-w-0 flex-1 truncate font-semibold">{e.name}</span>
            </div>
            {e.error && <Alert type="error" title={e.error} />}
            {e.plan && (
              <>
                <span className={fieldLabel}>Into</span>
                <Select
                  size="small"
                  disabled={busy}
                  value={e.plan.target.kind === "existing" ? e.plan.target.environment_id : NEW}
                  onChange={(v) => retarget(i, v)}
                  options={[
                    ...collection.environments.map((env) => ({ value: env.id, label: `${env.name} (fill my Secrets)` })),
                    { value: NEW, label: "New Environment (shared with every Member)" },
                  ]}
                />
                {e.plan.target.kind === "new" && cannotSave && (
                  <Alert type="warning" title="You can't create Environments in this Collection. Pick an existing one to fill its Secrets." />
                )}
                {e.plan.target.kind === "new" && (
                  <p className="text-z-muted">
                    Creates "{e.plan.target.environment.name}" with {e.plan.target.environment.variables.length} variable(s).
                  </p>
                )}
                {e.plan.fills.length > 0 && (
                  <ul className="flex flex-col gap-0.5">
                    {e.plan.fills.map((f) => (
                      <li key={f.var_id} className="flex items-center gap-1.5">
                        <LuKeyRound className="text-z-muted" />
                        <span className="select-text">{f.key}</span>
                        {f.overwrites && <Tag color="warning">replaces your value</Tag>}
                      </li>
                    ))}
                  </ul>
                )}
                {e.plan.target.kind === "existing" && e.plan.fills.length === 0 && (
                  <p className="text-z-muted">No Secrets to fill from this file.</p>
                )}
                {e.plan.skipped.length > 0 && (
                  <details className="text-z-muted">
                    <summary>{e.plan.skipped.length} skipped</summary>
                    <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                      {e.plan.skipped.map((s, j) => (
                        <li key={j}>
                          <span className="select-text">{s.key}</span>: {SKIP_TEXT[s.reason]}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </section>
        ))}
      </div>
    </Modal>
  );
}
