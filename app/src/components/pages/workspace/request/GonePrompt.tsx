import { Alert, Button, Space } from "antd";
import type { RequestItem } from "@/bindings/RequestItem";

/** Shown when the Request being edited was deleted by a teammate: restore it with my edits, or accept the deletion. */
export function GonePrompt({ item, onRestore, onAccept }: { item: RequestItem; onRestore: () => void; onAccept: () => void }) {
  return (
    <Alert
      type="warning"
      showIcon
      title={
        <>
          <b>{item.name}</b> was deleted by a teammate while you were editing it.
        </>
      }
      action={
        <Space>
          <Button size="small" type="primary" onClick={onRestore}>
            Restore with my changes
          </Button>
          <Button size="small" onClick={onAccept}>
            Accept deletion
          </Button>
        </Space>
      }
    />
  );
}
