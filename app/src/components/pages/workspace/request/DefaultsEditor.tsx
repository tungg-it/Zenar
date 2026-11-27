import { Button, Tabs } from "antd";
import { LuSave } from "react-icons/lu";
import type { Auth } from "@/bindings/Auth";
import type { KeyValue } from "@/bindings/KeyValue";
import { AuthEditor } from "./AuthEditor";
import { KeyValueEditor } from "./KeyValueEditor";
import { requestTabs, TabCount } from "@/components/ui";

/** Headers + auth set on a Collection or Folder, inherited by Requests below it. */
export function DefaultsEditor({
  title,
  kind,
  stats,
  headers,
  auth,
  onChange,
  onSave,
  saving = false,
  readOnly = false,
}: {
  title: string;
  kind: "Collection" | "Folder";
  /** Short facts under the title, e.g. "12 Requests". */
  stats: string[];
  headers: KeyValue[];
  auth: Auth | undefined;
  onChange: (headers: KeyValue[], auth: Auth | undefined) => void;
  onSave: () => void;
  saving?: boolean;
  readOnly?: boolean;
}) {
  return (
    <div className="px-4 py-2.5">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0 truncate">
          <span className="font-semibold">{title}</span>
        </div>
        <Button icon={<LuSave />} onClick={onSave} loading={saving} disabled={readOnly}>
          Save
        </Button>
      </div>
      <Tabs
        className={requestTabs}
        items={[
          {
            key: "overview",
            label: "Overview",
            children: (
              <div className="mx-auto my-4 max-w-[760px]">
                <h1 className="mt-0 mb-3 text-xl">{title}</h1>
                <div className="mb-4 flex flex-wrap gap-4 border-b border-z-border pb-4 text-z-muted">
                  <span>{kind}</span>
                  {stats.map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                </div>
                <p className="text-z-muted">Headers and authorization set here are inherited by every Request below this {kind}.</p>
              </div>
            ),
          },
          { key: "auth", label: "Authorization", children: <AuthEditor auth={auth} inheritLabel="No auth set here" onChange={(a) => onChange(headers, a)} /> },
          { key: "headers", label: <TabCount label="Headers" n={headers.filter((h) => h.enabled && h.key).length} />, children: <KeyValueEditor rows={headers} onChange={(h) => onChange(h, auth)} /> },
        ]}
      />
    </div>
  );
}
