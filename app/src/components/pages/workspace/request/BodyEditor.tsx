import { useEffect, useRef, useState } from "react";
import { App as AntApp, Button, Dropdown, Radio } from "antd";
import { LuChevronDown, LuTrash2, LuWandSparkles } from "react-icons/lu";
import type { RequestItem } from "@/bindings/RequestItem";
import type { EditorLanguage } from "@/libs/body-format";
import { BinaryBody } from "./BinaryBody";
import { CodeEditor } from "./CodeEditor";
import { VarInput } from "./VarInput";
import { FormDataBody } from "./FormDataBody";
import { graphqlVariables, withGraphqlVariables } from "@/libs/request-body";
import { moveItem } from "@/libs/key-value";
import { fieldLabel, IconButton, KvRow, KvTable } from "@/components/ui";

// Stored `body_type` values: null (none), "formdata" (fields in body_extra), "form"
// (x-www-form-urlencoded, one key=value per line), "binary" (file path in body_extra), "graphql"
// (query in body, variables in body_extra), or a raw language. "raw" (older files) is raw without a
// Content-Type and shows as Text.
const RAW_LANGUAGES: { key: EditorLanguage; label: string }[] = [
  { key: "text", label: "Text" },
  { key: "javascript", label: "JavaScript" },
  { key: "json", label: "JSON" },
  { key: "html", label: "HTML" },
  { key: "xml", label: "XML" },
];

type Mode = "none" | "formdata" | "form" | "raw" | "binary" | "graphql";

const MODES: { value: Mode; label: string }[] = [
  { value: "none", label: "none" },
  { value: "formdata", label: "form-data" },
  { value: "form", label: "x-www-form-urlencoded" },
  { value: "raw", label: "raw" },
  { value: "binary", label: "binary" },
  { value: "graphql", label: "GraphQL" },
];

const modeOf = (t: string | null | undefined): Mode =>
  !t ? "none" : t === "form" || t === "formdata" || t === "binary" || t === "graphql" ? t : "raw";
const languageOf = (t: string | null | undefined): EditorLanguage =>
  RAW_LANGUAGES.some((l) => l.key === t) ? (t as EditorLanguage) : "text";

type Snapshot = Pick<RequestItem, "body" | "body_type" | "body_extra">;
const EMPTY: Record<Exclude<Mode, "none">, Snapshot> = {
  formdata: { body: "", body_type: "formdata", body_extra: { fields: [] } },
  form: { body: "", body_type: "form", body_extra: null },
  raw: { body: "", body_type: "json", body_extra: null },
  binary: { body: "", body_type: "binary", body_extra: { file: "" } },
  graphql: { body: "", body_type: "graphql", body_extra: { variables: "" } },
};

/** Body tab: none / form-data / x-www-form-urlencoded / raw (with language) / binary / GraphQL. */
export function BodyEditor({ item, onChange }: { item: RequestItem; onChange: (r: RequestItem) => void }) {
  const { message } = AntApp.useApp();
  const mode = modeOf(item.body_type);
  const language = languageOf(item.body_type);
  const setBody = (body: string) => onChange({ ...item, body });

  // What each mode held before switching away, so switching modes never loses typed content.
  const stash = useRef<{ id: string; modes: Partial<Record<Mode, Snapshot>> }>({ id: item.id, modes: {} });
  if (stash.current.id !== item.id) stash.current = { id: item.id, modes: {} };

  function pickMode(m: Mode) {
    if (m === mode) return;
    if (mode !== "none") stash.current.modes[mode] = { body: item.body, body_type: item.body_type, body_extra: item.body_extra ?? null };
    if (m === "none") return onChange({ ...item, body: null, body_type: null, body_extra: null });
    onChange({ ...item, ...(stash.current.modes[m] ?? EMPTY[m]) });
  }

  function beautify() {
    try {
      setBody(JSON.stringify(JSON.parse(item.body ?? ""), null, 2));
    } catch {
      message.warning("The body is not valid JSON, so it cannot be beautified.");
    }
  }

  return (
    <div className="flex h-full flex-col gap-2 pb-3">
      <div className="flex flex-wrap items-center gap-1">
        <Radio.Group value={mode} onChange={(e) => pickMode(e.target.value)} options={MODES} />
        {mode === "raw" && (
          <Dropdown
            trigger={["click"]}
            menu={{
              selectedKeys: [language],
              items: RAW_LANGUAGES.map((l) => ({ key: l.key, label: l.label, onClick: () => onChange({ ...item, body_type: l.key }) })),
            }}
          >
            <Button type="link" size="small" className="inline-flex items-center gap-1 px-1">
              {RAW_LANGUAGES.find((l) => l.key === language)!.label} <LuChevronDown />
            </Button>
          </Dropdown>
        )}
        <span className="flex-1" />
        {mode === "raw" && language === "json" && (
          <Button type="link" size="small" icon={<LuWandSparkles />} onClick={beautify}>
            Beautify
          </Button>
        )}
      </div>
      {mode === "none" && <p className="my-2 text-z-muted">This request does not have a body.</p>}
      {mode === "raw" && <CodeEditor variables value={item.body ?? ""} onChange={setBody} language={language} label="Request body" />}
      {mode === "form" && <FormBody key={item.id} value={item.body ?? ""} onChange={setBody} />}
      {mode === "formdata" && <FormDataBody item={item} onChange={onChange} />}
      {mode === "binary" && <BinaryBody item={item} onChange={onChange} />}
      {mode === "graphql" && (
        <div className="grid min-h-0 flex-1 grid-cols-[1.4fr_1fr] gap-3">
          <div className="flex min-w-0 flex-col">
            <span className={fieldLabel}>Query</span>
            <CodeEditor variables value={item.body ?? ""} onChange={setBody} language="graphql" label="GraphQL query" />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className={fieldLabel}>GraphQL variables (JSON)</span>
            <CodeEditor variables value={graphqlVariables(item)} onChange={(v) => onChange(withGraphqlVariables(item, v))} language="json" label="GraphQL variables" />
          </div>
        </div>
      )}
    </div>
  );
}

type Row = { id: string; key: string; value: string };

const parse = (s: string): Row[] =>
  s
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const i = l.indexOf("=");
      return { id: crypto.randomUUID(), key: i < 0 ? l : l.slice(0, i), value: i < 0 ? "" : l.slice(i + 1) };
    });
const serialize = (rows: Row[]) => rows.filter((r) => r.key || r.value).map((r) => `${r.key}=${r.value}`).join("\n");

/** A borderless cell input that shows a thin frame while focused (as in KeyValueEditor). */
const cell = "h-full rounded-none focus:inset-ring focus:inset-ring-z-border-strong";

/**
 * x-www-form-urlencoded as a key/value table laid out like Headers (Key, Value, a trash button on
 * hover; typing in the last, empty row adds a field), stored as one `key=value` line per field.
 */
function FormBody({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // Rows live here so ids (and input focus) stay stable while typing; the body is derived from them.
  const [rows, setRows] = useState<Row[]>(() => parse(value));
  useEffect(() => {
    if (serialize(rows) !== value) setRows(parse(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (next: Row[]) => {
    setRows(next);
    onChange(serialize(next));
  };
  const set = (i: number, patch: Partial<Row>) => update(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // Id of the empty last row: the row keeps it once typed in, so its input keeps the focus.
  const [ghostId, setGhostId] = useState(() => crypto.randomUUID());
  const add = (patch: Partial<Row>) => {
    update([...rows, { id: ghostId, key: "", value: "", ...patch }]);
    setGhostId(crypto.randomUUID());
  };

  return (
    <KvTable role="table" className="border-x border-z-border" onMove={(from, to) => update(moveItem(rows, from, to))}>
      <KvRow columns="pair" head role="row">
        <span>Key</span>
        <span>Value</span>
      </KvRow>
      {[
        ...rows.map((r, i) => (
          <KvRow columns="pair" role="row" key={r.id} index={i} className="group/kv">
            <div>
              <VarInput variant="borderless" rootClassName="h-full" className={cell} placeholder="Key" value={r.key} onChange={(key) => set(i, { key })} />
            </div>
            <div>
              <VarInput variant="borderless" rootClassName="h-full" className={cell} placeholder="Value" aria-label={`Value of ${r.key}`} value={r.value} onChange={(value) => set(i, { value })} />
              <IconButton
                label="Delete"
                icon={<LuTrash2 />}
                className="mr-1 flex-none opacity-0 group-hover/kv:opacity-100 focus-visible:opacity-100"
                onClick={() => update(rows.filter((_, j) => j !== i))}
              />
            </div>
          </KvRow>
        )),
        // Same array and same cell shapes as a row: typing here turns it into a row without a remount.
        <KvRow columns="pair" role="row" key={ghostId}>
          <div>
            <VarInput variant="borderless" rootClassName="h-full" className={cell} placeholder="Key" value="" onChange={(key) => add({ key })} />
          </div>
          <div>
            <VarInput variant="borderless" rootClassName="h-full" className={cell} placeholder="Value" aria-label="New value" value="" onChange={(value) => add({ value })} />
          </div>
        </KvRow>,
      ]}
    </KvTable>
  );
}
