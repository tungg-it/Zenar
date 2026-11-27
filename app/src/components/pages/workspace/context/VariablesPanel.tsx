import { useState } from "react";
import { App, Button, Input, Tooltip } from "antd";
import { LuChevronDown, LuChevronRight, LuEye, LuEyeOff } from "react-icons/lu";
import type { EnvironmentItem } from "@/bindings/EnvironmentItem";
import type { PreviewVar } from "@/bindings/PreviewVar";
import type { RequestPreview } from "@/bindings/RequestPreview";
import { IconButton, treeEmpty } from "@/components/ui";
import { cx } from "@/libs/cx";
import { saveEnvironment, setSecretValue } from "@/service/environment";
import { ctxHead, ctxPanel } from "./styles";

const SOURCE = {
  environment: { badge: "E", title: "Environment", color: "text-z-get" },
  captured: { badge: "C", title: "Captured Variable (this machine)", color: "text-z-link" },
} as const;

const badge = "inline-flex size-[18px] items-center justify-center rounded border border-current text-2xs font-bold";
const cell = "truncate";
const list = "mb-1 flex flex-col border-t border-z-border";
const valueText = "min-w-0 cursor-text truncate rounded px-[7px] py-0.5 font-mono text-code select-text";

/**
 * Value cell: click to edit, Enter or leaving the field saves, Esc cancels. `onSave` is undefined
 * when the value can't be edited here (Captured Variables, no active Environment, read-only).
 */
function ValueCell({
  shown,
  initial,
  secret,
  missing,
  onSave,
  why,
}: {
  shown: React.ReactNode;
  initial: string;
  secret: boolean;
  missing: boolean;
  onSave?: (value: string) => Promise<void>;
  why: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (draft !== null && onSave) {
    const commit = async () => {
      if (draft === initial) return setDraft(null);
      setBusy(true);
      try {
        await onSave(draft);
        setDraft(null);
      } finally {
        setBusy(false);
      }
    };
    const props = {
      size: "small" as const,
      autoFocus: true,
      className: "font-mono text-code",
      value: draft,
      disabled: busy,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
      // Enter leaves the field; leaving it saves (once).
      onPressEnter: (e: React.KeyboardEvent<HTMLInputElement>) => e.currentTarget.blur(),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => e.key === "Escape" && setDraft(null),
      "aria-label": "Variable value",
    };
    return secret ? <Input.Password {...props} /> : <Input {...props} />;
  }
  return (
    <Tooltip title={onSave ? undefined : why} mouseEnterDelay={0.4}>
      <span
        role={onSave ? "button" : undefined}
        tabIndex={onSave ? 0 : undefined}
        className={cx(valueText, onSave ? "hover:bg-z-hover" : "cursor-default", missing ? "text-z-post" : "text-z-muted")}
        onClick={() => onSave && setDraft(initial)}
        onKeyDown={(e) => onSave && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setDraft(initial))}
      >
        {shown}
      </span>
    </Tooltip>
  );
}

type RowProps = {
  name: string;
  v: PreviewVar | undefined;
  secret: boolean;
  reveal: boolean;
  onSave?: (value: string) => Promise<void>;
  why: string;
};

function VarRow({ name, v, secret, reveal, onSave, why }: RowProps) {
  return (
    <div className="grid min-h-8 grid-cols-[20px_minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 border-b border-z-border px-1">
      {v ? (
        <Tooltip title={SOURCE[v.source].title}>
          <span className={cx(badge, SOURCE[v.source].color)}>{SOURCE[v.source].badge}</span>
        </Tooltip>
      ) : (
        <Tooltip title="No value in the active Environment or Captured Variables">
          <span className={cx(badge, "text-z-post")}>?</span>
        </Tooltip>
      )}
      <span className={cell} title={name}>
        {name}
      </span>
      <ValueCell
        initial={v?.value ?? ""}
        secret={secret}
        missing={!v}
        onSave={onSave}
        why={why}
        shown={!v ? "no value" : secret && !reveal ? "••••••••" : v.value || <span className="text-z-faint">empty</span>}
      />
    </div>
  );
}

/**
 * Variables the Request uses with their resolved values, then every variable available. Values of
 * the active Environment are edited in place: a shared variable is saved to the Collection (shared
 * with every Member), a Secret only to this machine. A missing variable is added to the
 * active Environment.
 */
export function VariablesPanel({
  root,
  preview,
  env,
  readOnly,
  onChanged,
}: {
  root: string;
  preview: RequestPreview | null;
  /** The active Environment, or null. */
  env: EnvironmentItem | null;
  readOnly: boolean;
  /** After a save: reload what the panel shows. */
  onChanged: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const [showAll, setShowAll] = useState(false);
  const [reveal, setReveal] = useState(false);
  const byName = new Map((preview?.variables ?? []).map((v) => [v.name, v]));
  const envVar = (name: string) => env?.variables.find((x) => x.key === name);
  const isSecret = (v: PreviewVar | undefined) => !!v && v.source === "environment" && !!envVar(v.name)?.secret;
  const hasSecret = (preview?.variables ?? []).some(isSecret);

  async function save(name: string, value: string) {
    if (!env) return;
    const existing = envVar(name);
    try {
      if (existing?.secret) {
        await setSecretValue(root, env.id, existing.id, value);
      } else {
        const variables = existing
          ? env.variables.map((x) => (x.id === existing.id ? { ...x, value } : x))
          : [...env.variables, { id: crypto.randomUUID(), key: name, value, secret: false }];
        const result = await saveEnvironment(root, env, { ...env, variables });
        if (result.status === "conflict") {
          message.error(`Someone else changed ${name} in ${env.name}. Edit it from Environments to compare.`);
          return;
        }
        message.success(`Saved ${name} to ${env.name}`);
      }
      await onChanged();
    } catch (e) {
      message.error(String(e));
      throw e;
    }
  }

  // A Captured Variable hides the Environment's value, so editing it here would change nothing visible.
  const editable = (name: string, v: PreviewVar | undefined): { onSave?: (value: string) => Promise<void>; why: string } => {
    if (v?.source === "captured") return { why: "Captured from a response on this machine; not editable here" };
    if (!env) return { why: "Pick an Environment to set values" };
    if (readOnly && !envVar(name)?.secret) return { why: "This Collection is read-only" };
    return { onSave: (value) => save(name, value), why: "" };
  };
  const row = (name: string, v: PreviewVar | undefined) => (
    <VarRow key={name} name={name} v={v} secret={isSecret(v)} reveal={reveal} {...editable(name, v)} />
  );

  return (
    <div className={ctxPanel}>
      <div className={ctxHead}>
        <span className="font-semibold">Variables</span>
        {hasSecret && <IconButton label={reveal ? "Hide secret values" : "Show secret values"} icon={reveal ? <LuEyeOff /> : <LuEye />} onClick={() => setReveal(!reveal)} />}
      </div>
      <p className="-mt-1.5 mb-2 text-sm text-z-muted">Environment: {env?.name ?? "none"}</p>
      {/* Only the variables this Request refers to; the Environment's full list is under "All variables". */}
      <p className="mb-1 text-sm font-semibold text-z-muted">Used in this request{preview ? ` (${preview.used.length})` : ""}</p>
      {!preview ? (
        <p className={treeEmpty}>Loading…</p>
      ) : preview.used.length === 0 ? (
        <p className={treeEmpty}>This Request uses no {"{{variables}}"}.</p>
      ) : (
        <div className={list}>{preview.used.map((n) => row(n, byName.get(n)))}</div>
      )}
      <Button type="text" size="small" className="mt-2 mb-1 self-start text-z-muted" icon={showAll ? <LuChevronDown /> : <LuChevronRight />} onClick={() => setShowAll(!showAll)}>
        All variables{preview ? ` (${preview.variables.length})` : ""}
      </Button>
      {showAll && preview && (
        <div className={list}>
          {preview.variables.length === 0 && <p className={treeEmpty}>No variables. Pick an Environment, or capture values from a response.</p>}
          {preview.variables.map((v) => row(v.name, v))}
        </div>
      )}
    </div>
  );
}
