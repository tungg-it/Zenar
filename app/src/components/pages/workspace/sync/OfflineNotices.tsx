// Needs Attention list (Conflicts found when queued Saves were pushed) plus the offline / Viewer notices.
import { Alert, Button } from "antd";
import type { AttentionItem } from "@/bindings/AttentionItem";
import type { OfflineStatus } from "@/bindings/OfflineStatus";

export function OfflineNotices({
  status,
  notice,
  onDismissNotice,
  onOpen,
}: {
  status: OfflineStatus;
  /** One-off message from the last Save (offline, protected branch, first Viewer rejection). */
  notice: string | null;
  onDismissNotice: () => void;
  onOpen: (item: AttentionItem) => void;
}) {
  return (
    <>
      {notice && <Alert banner type="warning" role="status" title={notice} closable={{ onClose: onDismissNotice }} />}
      {status.viewer && (
        <Alert
          banner
          type="info"
          title="You have view-only access to this Collection on this machine. You can still open and run Requests; your edits stay as Drafts."
        />
      )}
      {status.needs_attention.length > 0 && (
        <Alert
          banner
          type="error"
          role="region"
          aria-label="Needs Attention"
          title={`Needs Attention (${status.needs_attention.length}): these Saves conflict with another Member's change`}
          description={
            <div className="mt-1 flex flex-wrap gap-1.5">
              {status.needs_attention.map((i) => (
                <Button key={i.request_id} size="small" onClick={() => onOpen(i)}>
                  "{i.name}" ({i.fields.join(", ")})
                </Button>
              ))}
            </div>
          }
        />
      )}
    </>
  );
}
