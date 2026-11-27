import { useState } from "react";
import { Button, Checkbox, Modal, Space, Tooltip } from "antd";
import { LuInfo } from "react-icons/lu";
import type { RequestItem } from "@/bindings/RequestItem";

/** Asked when closing a tab with unsaved changes: Save (and close), Don't save (discard the Draft), or Cancel. */
export function UnsavedTabDialog({
  item,
  saving,
  readOnly,
  onSave,
  onDiscard,
  onCancel,
}: {
  item: RequestItem;
  saving: boolean;
  /** The Collection is read-only: the changes can only be discarded. */
  readOnly: boolean;
  onSave: () => void;
  /** `always`: stop asking and discard on every later close. */
  onDiscard: (always: boolean) => void;
  onCancel: () => void;
}) {
  const [always, setAlways] = useState(false);
  return (
    <Modal
      open
      title="Save changes?"
      width={460}
      onCancel={onCancel}
      maskClosable={!saving}
      closable={!saving}
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button onClick={() => onDiscard(always)} disabled={saving}>
            Don't save
          </Button>
          <Space>
            <Button onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button type="primary" onClick={onSave} loading={saving} disabled={readOnly} autoFocus>
              Save changes
            </Button>
          </Space>
        </div>
      }
    >
      <p>
        <b className="break-all text-z-text">{item.name}</b> has unsaved changes. Save them to share with every Member, or they will be lost.
      </p>
      <Checkbox checked={always} onChange={(e) => setAlways(e.target.checked)}>
        Always discard unsaved changes when closing a tab
      </Checkbox>
      <Tooltip title="Applies when you pick Don't save. Turn it off again in Settings.">
        <LuInfo className="ml-1.5 cursor-help align-[-2px] text-z-muted" aria-label="About this option" />
      </Tooltip>
    </Modal>
  );
}
