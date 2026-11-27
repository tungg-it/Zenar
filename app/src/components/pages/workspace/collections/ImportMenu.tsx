import { useRef, useState } from "react";
import { App as AntApp, Button, Dropdown } from "antd";
import { LuGitBranch, LuLayers, LuUpload } from "react-icons/lu";
import { importPostman, openCollection } from "@/service/collection";
import type { CollectionData } from "@/bindings/CollectionData";
import { ImportEnvironmentDialog, type EnvironmentFile } from "../environments";

type Props = {
  root: string;
  collection: CollectionData | null;
  onImported: (c: CollectionData) => void;
  /** The Collection cannot be changed here (newer format): no Collection import. */
  readOnly?: boolean;
  /** This machine cannot Save: an environment file can only fill existing Environments. */
  cannotSave?: boolean;
};

/**
 * Import button: a Postman v2.1 collection (every Member gets the Requests) or environment files
 * (Postman environment / `.env`, previewed before anything is written).
 */
export function ImportMenu({ root, collection, onImported, readOnly = false, cannotSave = false }: Props) {
  const { message } = AntApp.useApp();
  const collectionInput = useRef<HTMLInputElement>(null);
  const envInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [envFiles, setEnvFiles] = useState<EnvironmentFile[] | null>(null);

  async function pickCollection(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const report = await importPostman(root, await file.text());
      onImported(await openCollection(root));
      // A re-import of this Collection's own export that changes nothing makes no commit.
      const text =
        (report.commit
          ? `Imported ${report.requests} request${report.requests === 1 ? "" : "s"}` +
            (report.updated ? ` (${report.updated} updated in place)` : "")
          : "Nothing to import: the Collection already matches this file") +
        (report.warnings.length ? ` (${report.warnings.length} skipped: ${report.warnings.join("; ")})` : "");
      if (report.warnings.length) message.warning(text, 8);
      else message.success(text);
    } catch (e) {
      message.error(String(e), 8);
    } finally {
      setBusy(false);
      if (collectionInput.current) collectionInput.current.value = "";
    }
  }

  async function pickEnvironments(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (envInput.current) envInput.current.value = "";
    if (files.length) setEnvFiles(await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))));
  }

  return (
    <>
      <input ref={collectionInput} type="file" accept=".json,application/json" hidden onChange={(e) => pickCollection(e.target.files?.[0])} />
      {/* No accept filter: `.env` files have no extension the picker knows. */}
      <input ref={envInput} type="file" multiple hidden onChange={(e) => pickEnvironments(e.target.files)} />
      <Dropdown
        trigger={["click"]}
        disabled={!root || !collection || busy}
        menu={{
          items: [
            { key: "collection", icon: <LuGitBranch />, label: "Collection (Postman)", disabled: readOnly },
            { key: "environment", icon: <LuLayers />, label: "Environment (Postman, .env)" },
          ],
          onClick: ({ key }) => (key === "collection" ? collectionInput : envInput).current?.click(),
        }}
      >
        <Button size="small" icon={<LuUpload />} loading={busy}>
          Import
        </Button>
      </Dropdown>
      {collection && (
        <ImportEnvironmentDialog
          root={root}
          collection={collection}
          files={envFiles}
          cannotSave={cannotSave || readOnly}
          onClose={() => setEnvFiles(null)}
          onImported={onImported}
        />
      )}
    </>
  );
}
