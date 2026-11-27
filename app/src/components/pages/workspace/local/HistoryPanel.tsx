import { useEffect, useState } from "react";
import { Alert } from "antd";
import { LuTrash2 } from "react-icons/lu";
import { clearHistory, getHistory } from "@/service/runner";
import type { HistoryEntry } from "@/bindings/HistoryEntry";
import { IconButton, MethodTag, SectionTitle, sidebarAlert, treeEmpty, treeName, treeRow } from "@/components/ui";
import { cx } from "@/libs/cx";

/** Sidebar History view: Requests sent from this machine, newest first. */
export function HistoryPanel({ root, refreshKey }: { root: string; refreshKey: number }) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!root) return;
    getHistory(root).then(setHistory).catch((e) => setError(String(e)));
  }, [root, refreshKey]);

  return (
    <div>
      <SectionTitle
        extra={<IconButton label="Clear history" icon={<LuTrash2 />} disabled={!history.length} onClick={() => clearHistory(root).then(() => setHistory([]))} />}
      >
        History (this machine)
      </SectionTitle>
      {error && <Alert type="error" title={error} className={sidebarAlert} />}
      {history.length === 0 && <p className={treeEmpty}>Requests you send appear here.</p>}
      {history.map((h, i) => (
        <div key={i} className={treeRow({ clickable: false })} title={h.request.url}>
          <MethodTag method={h.request.method} compact />
          <span className={cx(treeName, "font-mono text-code")}>{h.request.url}</span>
          <span className={cx("text-xs", h.response.status >= 400 ? "text-z-delete" : "text-z-get")}>{h.response.status}</span>
          <span className="text-xs text-z-faint">{new Date(Number(h.at_ms)).toLocaleTimeString()}</span>
        </div>
      ))}
    </div>
  );
}
