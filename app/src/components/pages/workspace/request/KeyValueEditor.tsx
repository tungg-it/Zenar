import { useState } from "react";
import { Button, Checkbox, Input } from "antd";
import { LuTrash2 } from "react-icons/lu";
import type { KeyValue } from "@/bindings/KeyValue";
import { IconButton, KvRow, KvTable } from "@/components/ui";
import { cx } from "@/libs/cx";
import { fromBulk, kvDescription, moveItem, toBulk, withDescription } from "@/libs/key-value";
import { VarInput } from "./VarInput";

/** A borderless cell input that shows a thin frame while focused, like Postman's table cells. */
const cell = "h-full rounded-none focus:inset-ring focus:inset-ring-z-border-strong";

/**
 * Postman-style key/value table (Params, Headers, Path Variables): enabled checkbox, Key, Value,
 * Description, a trash button on hover, and Bulk Edit (`key:value` lines, `//` = disabled).
 * Typing in the last, empty row adds a row. With `fixedKeys` (Path Variables) the keys come from
 * elsewhere: no checkbox, no new or removed rows, Bulk Edit only changes values.
 */
export function KeyValueEditor({ rows, onChange, fixedKeys = false }: { rows: KeyValue[]; onChange: (rows: KeyValue[]) => void; fixedKeys?: boolean }) {
  const [bulkOn, setBulkOn] = useState(false);
  // Bulk text as typed, kept while `rows` is what it produced (rebuilding would eat a trailing ":").
  const [typed, setTyped] = useState<{ text: string; rows: KeyValue[] } | null>(null);
  // Id of the empty last row: the row keeps it once typed in, so its input keeps the focus.
  const [ghostId, setGhostId] = useState(() => crypto.randomUUID());

  const set = (i: number, patch: Partial<KeyValue>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = (patch: Partial<KeyValue>) => {
    onChange([...rows, { id: ghostId, key: "", value: "", enabled: true, ...patch }]);
    setGhostId(crypto.randomUUID());
  };
  const bulkText = typed && typed.rows === rows ? typed.text : toBulk(rows);
  const onBulk = (text: string) => {
    const next = fromBulk(text, rows, fixedKeys);
    setTyped({ text, rows: next });
    onChange(next);
  };

  const toggle = (
    <Button type="text" size="small" className="ml-auto font-normal text-z-muted" onClick={() => setBulkOn(!bulkOn)}>
      {bulkOn ? "Key-Value Edit" : "Bulk Edit"}
    </Button>
  );

  return (
    <KvTable role="table" className="border-x border-z-border" onMove={fixedKeys || bulkOn ? undefined : (from, to) => onChange(moveItem(rows, from, to))}>
      {bulkOn ? (
        // Postman drops the column titles while editing the rows as text.
        <div className="flex h-7 items-center justify-end border-b border-z-border pr-1">{toggle}</div>
      ) : (
        <KvRow columns="edit" head role="row">
          <span />
          <span>Key</span>
          <span>Value</span>
          <div className="pr-1 pl-[11px]">
            Description
            {toggle}
          </div>
        </KvRow>
      )}
      {bulkOn ? (
        <Input.TextArea
          variant="borderless"
          className="rounded-none border-b border-z-border font-mono text-code"
          autoSize={{ minRows: 3 }}
          placeholder={"Rows are separated by new lines\nKeys and values are separated by :\nPrepend // to any row you want to disable"}
          value={bulkText}
          onChange={(e) => onBulk(e.target.value)}
          aria-label="Bulk edit"
        />
      ) : (
        [
          ...rows.map((r, i) => (
            <KvRow columns="edit" role="row" key={r.id} index={i} className="group/kv">
              {fixedKeys ? <span /> : <Checkbox checked={r.enabled} aria-label="Enabled" onChange={(e) => set(i, { enabled: e.target.checked })} />}
              {fixedKeys ? (
                <span className="px-[11px] select-text">
                  <span className="truncate">{r.key}</span>
                </span>
              ) : (
                <VarInput variant="borderless" rootClassName="h-full" className={cell} placeholder="Key" value={r.key} onChange={(key) => set(i, { key })} />
              )}
              <VarInput variant="borderless" rootClassName="h-full" className={cell} placeholder="Value" aria-label={`Value of ${r.key}`} value={r.value} onChange={(value) => set(i, { value })} />
              <div>
                <Input
                  variant="borderless"
                  className={cx(cell, "flex-1")}
                  placeholder="Description"
                  value={kvDescription(r)}
                  onChange={(e) => set(i, withDescription(r, e.target.value))}
                />
                {!fixedKeys && (
                  <IconButton
                    label="Delete"
                    icon={<LuTrash2 />}
                    className="mr-1 flex-none opacity-0 group-hover/kv:opacity-100 focus-visible:opacity-100"
                    onClick={() => onChange(rows.filter((_, j) => j !== i))}
                  />
                )}
              </div>
            </KvRow>
          )),
          // Same array and same cell shapes as a row: typing here turns it into a row without a remount.
          !fixedKeys && (
            <KvRow columns="edit" role="row" key={ghostId}>
              <span />
              <VarInput variant="borderless" rootClassName="h-full" className={cell} placeholder="Key" value="" onChange={(key) => add({ key })} />
              <VarInput variant="borderless" rootClassName="h-full" className={cell} placeholder="Value" aria-label="New value" value="" onChange={(value) => add({ value })} />
              <div>
                <Input
                  variant="borderless"
                  className={cx(cell, "flex-1")}
                  placeholder="Description"
                  value=""
                  onChange={(e) => add(withDescription({}, e.target.value))}
                />
              </div>
            </KvRow>
          ),
        ]
      )}
    </KvTable>
  );
}
