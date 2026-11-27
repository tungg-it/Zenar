import { useEffect, useRef, useState } from "react";
import { syncCollection } from "@/service/collection";
import type { SyncReport } from "@/bindings/SyncReport";

const EVERY_MS = 60_000;
/** One failed fetch is usually a blip (offline). Tell the person only when it keeps failing. */
const FAILURES_BEFORE_NOTICE = 3;

/**
 * Background fetch of other Members' Saves on open, window focus and every minute. `failure` is a
 * message once fetching has failed several times in a row (offline, or the sign-in expired), and
 * `null` again after the next success. `syncNow` is the sidebar's Fetch button: it rejects with the
 * error at once, and `syncing` is true while it runs.
 */
export function useAutoSync(path: string | null, onReport: (r: SyncReport) => void) {
  const [failure, setFailure] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const now = useRef<() => Promise<void>>(() => Promise.resolve());
  useEffect(() => {
    if (!path) return;
    let live = true;
    let failures = 0;
    setFailure(null);
    const fetchOnce = () =>
      syncCollection(path).then((r) => {
        if (!live) return;
        failures = 0;
        setFailure(null);
        onReport(r);
      });
    const run = () =>
      fetchOnce().catch((e) => {
        if (live && ++failures >= FAILURES_BEFORE_NOTICE) setFailure(String(e));
      });
    now.current = fetchOnce;
    run();
    const timer = setInterval(run, EVERY_MS);
    window.addEventListener("focus", run);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", run);
    };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const syncNow = async () => {
    setSyncing(true);
    try {
      await now.current();
    } finally {
      setSyncing(false);
    }
  };
  return { failure, syncing, syncNow };
}
