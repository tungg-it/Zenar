import { useState } from "react";
import { Input } from "antd";
import { LuTrash2 } from "react-icons/lu";
import type { Capture } from "@/bindings/Capture";
import { fieldLabel, IconButton, KvRow, KvTable } from "@/components/ui";
import { cx } from "@/libs/cx";
import { kvDescription, moveItem, withDescription } from "@/libs/key-value";
import { VarInput } from "./VarInput";

/** A borderless cell input that shows a thin frame while focused, like Postman's table cells (as in KeyValueEditor). */
const cell = "h-full rounded-none focus:inset-ring focus:inset-ring-z-border-strong";

/** A name typed as `{{name}}`: the name alone. */
const bareName = (s: string) => s.trim().replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "");

/**
 * Captures tab, laid out like the Params / Headers table: Variable, JSONPath, Description, a trash button on hover.
 * Typing in the last, empty row adds a capture. The Variable cell suggests the names already in use.
 */
export function CapturesEditor({ rows, onChange }: { rows: Capture[]; onChange: (rows: Capture[]) => void }) {
  // Id of the empty last row: the row keeps it once typed in, so its input keeps the focus.
  const [ghostId, setGhostId] = useState(() => crypto.randomUUID());

  const set = (i: number, patch: Partial<Capture>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = (patch: Partial<Capture>) => {
    onChange([...rows, { id: ghostId, name: "", path: "", ...patch }]);
    setGhostId(crypto.randomUUID());
  };

  const cells = (c: Partial<Capture>, onSet: (patch: Partial<Capture>) => void, label: string) => [
    <VarInput
      key="name"
      bare
      variant="borderless"
      rootClassName="h-full"
      className={cell}
      placeholder="Variable"
      aria-label={`Variable ${label}`}
      value={c.name ?? ""}
      onChange={(name) => onSet({ name })}
      onBlur={(e) => bareName(e.target.value) !== e.target.value && onSet({ name: bareName(e.target.value) })}
    />,
    <Input key="path" variant="borderless" className={cx(cell, "font-mono text-code")} placeholder="$.data.token" aria-label={`JSONPath ${label}`} value={c.path ?? ""} onChange={(e) => onSet({ path: e.target.value })} />,
  ];

  return (
    <>
      <span className={fieldLabel}>
        Save a JSON response value (JSONPath) as a variable, usable as {"{{name}}"} in later Requests. Values stay on this machine.
      </span>
      <KvTable role="table" className="border-x border-z-border" onMove={(from, to) => onChange(moveItem(rows, from, to))}>
        <KvRow columns="capture" head role="row">
          <span>Variable</span>
          <span>JSONPath</span>
          <span>Description</span>
        </KvRow>
        {[
          ...rows.map((c, i) => (
            <KvRow columns="capture" role="row" key={c.id} index={i} className="group/kv">
              {cells(c, (p) => set(i, p), c.name)}
              <div>
                <Input
                  variant="borderless"
                  className={cx(cell, "flex-1")}
                  placeholder="Description"
                  value={kvDescription(c)}
                  onChange={(e) => set(i, withDescription(c, e.target.value))}
                />
                <IconButton
                  label="Delete"
                  icon={<LuTrash2 />}
                  className="mr-1 flex-none opacity-0 group-hover/kv:opacity-100 focus-visible:opacity-100"
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                />
              </div>
            </KvRow>
          )),
          // Same array and same cell shapes as a row: typing here turns it into a row without a remount.
          <KvRow columns="capture" role="row" key={ghostId}>
            {cells({}, add, "new")}
            <div>
              <Input
                variant="borderless"
                className={cx(cell, "flex-1")}
                placeholder="Description"
                value=""
                onChange={(e) => add(withDescription({}, e.target.value))}
              />
            </div>
          </KvRow>,
        ]}
      </KvTable>
    </>
  );
}
