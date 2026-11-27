import { useCallback, useEffect, useState } from "react";
import { drainQueue, offlineStatus } from "@/service/collection";
import type { DrainReport } from "@/bindings/DrainReport";
import type { OfflineStatus } from "@/bindings/OfflineStatus";

const EVERY_MS = 60_000;
const EMPTY: OfflineStatus = { queued: [], needs_attention: [], viewer: false };

/**
 * Pushes queued Saves when back online (on open, focus, the browser "online" event and every
 * minute) and exposes what is waiting / needs attention / whether this machine is a Viewer.
 */
export function useOfflineQueue(root: string | null, onDrained?: (r: DrainReport) => void) {
  const [status, setStatus] = useState<OfflineStatus>(EMPTY);

  const refresh = useCallback(async () => {
    if (!root) return setStatus(EMPTY);
    try {
      const report = await drainQueue(root);
      setStatus(await offlineStatus(root));
      if (report.saved.length || report.needs_attention.length || report.stopped) onDrained?.(report);
    } catch {
      /* offline or transient: try again on the next tick */
    }
  }, [root]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!root) return;
    refresh();
    const timer = setInterval(refresh, EVERY_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [root, refresh]);

  return { status, refresh };
}
