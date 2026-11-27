import { forwardRef, useImperativeHandle, useState } from "react";
import { Alert, Button, Checkbox, ConfigProvider, Input, Tooltip } from "antd";
import { LuLock, LuLockOpen, LuSave, LuTrash2 } from "react-icons/lu";
import { saveEnvironment } from "@/service/environment";
import type { EnvironmentItem } from "@/bindings/EnvironmentItem";
import { IconButton, KvRow, KvTable, preWrap } from "@/components/ui";
import { cx } from "@/libs/cx";
import { moveItem } from "@/libs/key-value";

type Variable = EnvironmentItem["variables"][number];

/** Lets the page save the tab in front (⌘S). */
export type EnvironmentEditorHandle = { save: () => void };

type Props = {
  root: string;
  /** The Environment as it was when the tab opened or was last saved (null for a new one). */
  base: EnvironmentItem | null;
  draft: EnvironmentItem;
  onChange: (e: EnvironmentItem) => void;
  onSaved: (e: EnvironmentItem) => void;
  active: boolean;
  onActiveChange: (active: boolean) => void;
  readOnly?: boolean;
};

/** A borderless cell input that shows a thin frame while focused, like Postman's table cells. */
const cell =
  "h-full rounded-none focus:inset-ring focus:inset-ring-z-border-strong";

/**
 * An Environment open as a tab, like Postman's: its name, the "active" checkbox, and the variables
 * table (Variable, Value, Secret lock and trash on hover; typing in the empty last row adds a row).
 * Save merges with what other Members saved since `base` was read; a clash asks before overwriting.
 */
export const EnvironmentEditor = forwardRef<EnvironmentEditorHandle, Props>(
  function EnvironmentEditor(
    {
      root,
      base,
      draft,
      onChange,
      onSaved,
      active,
      onActiveChange,
      readOnly = false,
    },
    ref,
  ) {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Another Member changed the same variable(s) meanwhile: ask before overwriting theirs.
    const [conflict, setConflict] = useState<string[] | null>(null);
    // Id of the empty last row: the row keeps it once typed in, so its input keeps the focus.
    const [ghostId, setGhostId] = useState(() => crypto.randomUUID());

    const vars = draft.variables;
    const set = (i: number, p: Partial<Variable>) =>
      onChange({
        ...draft,
        variables: vars.map((v, j) => (j === i ? { ...v, ...p } : v)),
      });
    const add = (p: Partial<Variable>) => {
      onChange({
        ...draft,
        variables: [
          ...vars,
          { id: ghostId, key: "", value: "", secret: false, ...p },
        ],
      });
      setGhostId(crypto.randomUUID());
    };

    async function save(overwrite = false) {
      if (readOnly || saving || !draft.name.trim()) return;
      setError(null);
      setSaving(true);
      try {
        const result = await saveEnvironment(root, base, draft, overwrite);
        if (result.status === "conflict") return setConflict(result.fields);
        setConflict(null);
        onSaved(draft);
      } catch (e) {
        setError(String(e));
      } finally {
        setSaving(false);
      }
    }

    useImperativeHandle(ref, () => ({ save: () => save() }));

    return (
      <div className="flex flex-col gap-2.5 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Tooltip
            title={
              active ? "Active Environment" : "Use as the active Environment"
            }
            mouseEnterDelay={0.4}
          >
            <Checkbox
              checked={active}
              disabled={!base}
              aria-label="Active Environment"
              onChange={(e) => onActiveChange(e.target.checked)}
            />
          </Tooltip>
          <Input
            variant="borderless"
            className="max-w-[420px] px-1 font-semibold"
            placeholder="Environment name"
            aria-label="Environment name"
            value={draft.name}
            disabled={readOnly}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
          />
          <Button
            className="ml-auto"
            icon={<LuSave />}
            onClick={() => save()}
            loading={saving}
            disabled={readOnly || !draft.name.trim()}
          >
            Save
          </Button>
        </div>

        {conflict && (
          <Alert
            type="warning"
            showIcon
            title={`Another Member changed ${conflict.join(", ")} while you were editing.`}
            description="Overwrite their change with yours, or close this tab without saving and open it again."
            action={
              <Button
                size="small"
                danger
                onClick={() => save(true)}
                loading={saving}
              >
                Overwrite
              </Button>
            }
          />
        )}
        {error && (
          <Alert
            type="error"
            showIcon
            title={<span className={preWrap}>{error}</span>}
            closable={{ onClose: () => setError(null) }}
          />
        )}

        {/* A Viewer sees the variables but can't change them. */}
        <ConfigProvider componentDisabled={readOnly}>
          <KvTable
            role="table"
            className="border-x border-z-border"
            onMove={readOnly ? undefined : (from, to) => onChange({ ...draft, variables: moveItem(vars, from, to) })}
          >
            <KvRow columns="env" head role="row">
              <span>Variable</span>
              <span>Value</span>
              <span />
            </KvRow>
            {[
              ...vars.map((v, i) => (
                <KvRow columns="env" role="row" key={v.id} index={i} className="group/kv">
                  <Input
                    variant="borderless"
                    className={cell}
                    placeholder="Variable"
                    aria-label="Variable"
                    value={v.key}
                    onChange={(e) => set(i, { key: e.target.value })}
                  />
                  {v.secret ? (
                    <Input.Password
                      variant="borderless"
                      className={cell}
                      placeholder="Your own value (kept on this machine)"
                      aria-label={`Value of ${v.key}`}
                      value={v.value}
                      onChange={(e) => set(i, { value: e.target.value })}
                    />
                  ) : (
                    <Input
                      variant="borderless"
                      className={cell}
                      placeholder="Value"
                      aria-label={`Value of ${v.key}`}
                      value={v.value}
                      onChange={(e) => set(i, { value: e.target.value })}
                    />
                  )}
                  <div className="justify-end gap-0.5 pr-1">
                    <IconButton
                      label={
                        v.secret
                          ? "Secret: kept on this machine, not shared. Click to share the value"
                          : "Shared value. Click to make it a Secret"
                      }
                      icon={v.secret ? <LuLock /> : <LuLockOpen />}
                      active={v.secret}
                      disabled={readOnly}
                      className={cx(
                        !v.secret &&
                          "opacity-0 group-hover/kv:opacity-100 focus-visible:opacity-100",
                      )}
                      onClick={() => set(i, { secret: !v.secret })}
                    />
                    <IconButton
                      label="Delete"
                      icon={<LuTrash2 />}
                      disabled={readOnly}
                      className="opacity-0 group-hover/kv:opacity-100 focus-visible:opacity-100"
                      onClick={() =>
                        onChange({
                          ...draft,
                          variables: vars.filter((_, j) => j !== i),
                        })
                      }
                    />
                  </div>
                </KvRow>
              )),
              // Same array and same cell shapes as a row: typing here turns it into a row without a remount.
              !readOnly && (
                <KvRow columns="env" role="row" key={ghostId}>
                  <Input
                    variant="borderless"
                    className={cell}
                    placeholder="Add variable"
                    aria-label="New variable"
                    value=""
                    onChange={(e) => add({ key: e.target.value })}
                  />
                  <Input
                    variant="borderless"
                    className={cell}
                    placeholder="Value"
                    aria-label="New value"
                    value=""
                    onChange={(e) => add({ value: e.target.value })}
                  />
                  <div />
                </KvRow>
              ),
            ]}
          </KvTable>
        </ConfigProvider>
        {vars.some((v) => v.secret) && (
          <p className="m-0 text-sm text-z-faint">
            Secret values stay on this machine; teammates fill in their own.
          </p>
        )}
      </div>
    );
  },
);
