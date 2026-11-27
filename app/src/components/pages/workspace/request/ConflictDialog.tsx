// Conflict view: my version and the remote version side by side, conflicting Fields highlighted.
import { Button, Modal } from "antd";
import type { ConflictInfo } from "@/bindings/ConflictInfo";
import type { KeyValue } from "@/bindings/KeyValue";
import type { RequestItem } from "@/bindings/RequestItem";

type Row = { key: string; label: string; mine: string; theirs: string };

const kv = (r: KeyValue | undefined) => (r ? `${r.enabled ? "" : "(off) "}${r.key}: ${r.value}` : "");
const str = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v));

function listRows(prefix: string, label: string, mine: KeyValue[], theirs: KeyValue[]): Row[] {
  const ids = [...new Set([...mine.map((r) => r.id), ...theirs.map((r) => r.id)])];
  return ids.map((id) => ({
    key: `${prefix}/${id}`,
    label,
    mine: kv(mine.find((r) => r.id === id)),
    theirs: kv(theirs.find((r) => r.id === id)),
  }));
}

export function conflictRows(mine: RequestItem, theirs: RequestItem | null): Row[] {
  const t = theirs;
  return [
    { key: "name", label: "Name", mine: mine.name, theirs: str(t?.name) },
    { key: "method", label: "Method", mine: mine.method, theirs: str(t?.method) },
    { key: "url", label: "URL", mine: mine.url, theirs: str(t?.url) },
    { key: "folder", label: "Folder", mine: mine.folder, theirs: str(t?.folder) },
    ...listRows("params", "Param", mine.params, t?.params ?? []),
    ...listRows("path_variables", "Path Variable", mine.path_variables ?? [], t?.path_variables ?? []),
    ...listRows("headers", "Header", mine.headers, t?.headers ?? []),
    { key: "auth", label: "Auth", mine: str(mine.auth), theirs: str(t?.auth) },
    { key: "body", label: "Body", mine: str(mine.body), theirs: str(t?.body) },
  ].filter((r) => r.mine !== "" || r.theirs !== "");
}

export function ConflictDialog({
  mine,
  info,
  busy,
  onOverwrite,
  onCancel,
}: {
  mine: RequestItem;
  info: ConflictInfo;
  busy: boolean;
  onOverwrite: () => void;
  onCancel: () => void;
}) {
  const conflicting = (key: string) => info.fields.includes(key);
  const when = info.theirs_time ? new Date(info.theirs_time).toLocaleString() : "";
  return (
    <Modal
      open
      width={880}
      title={`Conflict on "${mine.name}"`}
      closable={false}
      maskClosable={false}
      keyboard={false}
      footer={[
        <Button key="cancel" disabled={busy} onClick={onCancel}>
          Cancel (keep as Draft)
        </Button>,
        <Button key="over" type="primary" danger loading={busy} onClick={onOverwrite}>
          Overwrite
        </Button>,
      ]}
    >
      <p className="text-z-muted">
        {info.theirs_author ?? "Another Member"} changed the same Field(s)
        {info.theirs ? "" : " (they deleted this Request)"}. Overwrite keeps your values for the highlighted Fields and
        keeps their other changes; Cancel takes their version and keeps your changes as a Draft.
      </p>
      <table className="w-full border-collapse text-sm [&_td]:select-text [&_:is(td,th)]:border-b [&_:is(td,th)]:border-z-border [&_:is(td,th)]:px-2 [&_:is(td,th)]:py-1 [&_:is(td,th)]:text-left [&_:is(td,th)]:align-top [&_:is(td,th)]:break-all [&_:is(td,th)]:whitespace-pre-wrap [&_th]:font-semibold [&_th]:text-z-muted" role="table" aria-label="Conflict">
        <thead>
          <tr>
            <th></th>
            <th>Your version</th>
            <th>
              Their version — {info.theirs_author ?? "unknown"}
              {when && `, ${when}`}
            </th>
          </tr>
        </thead>
        <tbody>
          {conflictRows(mine, info.theirs).map((r) => (
            <tr key={r.key} className={conflicting(r.key) ? "[&>td]:bg-z-post/18 [&>td]:font-semibold" : ""}>
              <td>{r.label}</td>
              <td className="font-mono text-code">{r.mine}</td>
              <td className="font-mono text-code">{r.theirs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
