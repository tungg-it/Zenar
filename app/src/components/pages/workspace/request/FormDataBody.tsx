import { useState } from "react";
import { Button, Checkbox, Select, Tooltip } from "antd";
import { LuFile, LuTrash2, LuUpload } from "react-icons/lu";
import type { FormField } from "@/bindings/FormField";
import type { RequestItem } from "@/bindings/RequestItem";
import { fileName, formFields, withFormFields } from "@/libs/request-body";
import { pickFile } from "@/service/files";
import { IconButton, KvRow, KvTable } from "@/components/ui";
import { cx } from "@/libs/cx";
import { moveItem } from "@/libs/key-value";
import { VarInput } from "./VarInput";

/** A borderless cell input that shows a thin frame while focused (as in KeyValueEditor). */
const cell = "h-full rounded-none focus:inset-ring focus:inset-ring-z-border-strong";

/**
 * multipart/form-data fields, laid out like the Headers table: enabled checkbox, Key with Text or
 * File, Value, a trash button on hover. Typing in the last, empty row adds a field. File values
 * are paths on this machine.
 */
export function FormDataBody({ item, onChange }: { item: RequestItem; onChange: (r: RequestItem) => void }) {
  const fields = formFields(item);
  // Id of the empty last row: the row keeps it once typed in, so its input keeps the focus.
  const [ghostId, setGhostId] = useState(() => crypto.randomUUID());
  const update = (next: FormField[]) => onChange(withFormFields(item, next));
  const set = (i: number, patch: Partial<FormField>) => update(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const add = (patch: Partial<FormField>) => {
    update([...fields, { id: ghostId, key: "", value: "", type: "text", enabled: true, ...patch }]);
    setGhostId(crypto.randomUUID());
  };

  async function choose(i: number) {
    const path = await pickFile("Choose a file to send");
    if (path) set(i, { value: path });
  }

  return (
    <>
      <KvTable role="table" className="border-x border-z-border" onMove={(from, to) => update(moveItem(fields, from, to))}>
        <KvRow columns="check" head role="row">
          <span />
          <span>Key</span>
          <span>Value</span>
        </KvRow>
        {[
          ...fields.map((f, i) => (
            <KvRow columns="check" role="row" key={f.id} index={i} className="group/kv">
              <Checkbox checked={f.enabled} aria-label="Enabled" onChange={(e) => set(i, { enabled: e.target.checked })} />
              <div>
                <VarInput variant="borderless" rootClassName="h-full" className={cell} placeholder="Key" value={f.key} onChange={(key) => set(i, { key })} />
                <Select
                  size="small"
                  variant="borderless"
                  className="flex-none text-z-muted"
                  value={f.type}
                  popupMatchSelectWidth={false}
                  aria-label="Field type"
                  onChange={(type) => set(i, { type, value: "" })}
                  options={[
                    { value: "text", label: "Text" },
                    { value: "file", label: "File" },
                  ]}
                />
              </div>
              <div>
                {f.type === "file" ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2 px-[11px]">
                    {f.value ? (
                      <Tooltip title={f.value}>
                        <span className="inline-flex min-w-0 items-center gap-[5px] truncate">
                          <LuFile /> {fileName(f.value)}
                        </span>
                      </Tooltip>
                    ) : null}
                    <Button size="small" icon={<LuUpload />} onClick={() => choose(i)}>
                      {f.value ? "Change" : "Select file"}
                    </Button>
                  </div>
                ) : (
                  <VarInput
                    variant="borderless"
                    rootClassName="h-full"
                    className={cell}
                    placeholder="Value"
                    aria-label={`Value of ${f.key}`}
                    value={f.value}
                    onChange={(value) => set(i, { value })}
                  />
                )}
                <IconButton
                  label="Delete"
                  icon={<LuTrash2 />}
                  className="mr-1 flex-none opacity-0 group-hover/kv:opacity-100 focus-visible:opacity-100"
                  onClick={() => update(fields.filter((_, j) => j !== i))}
                />
              </div>
            </KvRow>
          )),
          // Same array and same cell shapes as a row: typing here turns it into a row without a remount.
          <KvRow columns="check" role="row" key={ghostId}>
            <span />
            <div>
              <VarInput variant="borderless" rootClassName="h-full" className={cell} placeholder="Key" value="" onChange={(key) => add({ key })} />
            </div>
            <div>
              <VarInput variant="borderless" rootClassName="h-full" className={cell} placeholder="Value" aria-label="New value" value="" onChange={(value) => add({ value })} />
            </div>
          </KvRow>,
        ]}
      </KvTable>
      {fields.some((f) => f.type === "file") && <p className="mt-1.5 mb-0 text-sm text-z-muted">File paths are on this machine. Members who run this Request pick their own file.</p>}
    </>
  );
}
