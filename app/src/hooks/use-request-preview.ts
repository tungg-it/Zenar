import { useEffect, useState } from "react";
import type { RequestItem } from "@/bindings/RequestItem";
import type { RequestPreview } from "@/bindings/RequestPreview";
import { previewRequest } from "@/service/runner";

const DEBOUNCE_MS = 250;

/**
 * The request Send would make for `item` (code snippet, variables in use), recomposed shortly after
 * each edit. A change in `refresh` (fixed length) recomposes too, e.g. a Send that updated the
 * Captured Variables or a synced Collection with new inherited headers.
 * Pass `item = null` (panel closed) to skip the work.
 */
export function useRequestPreview(
  root: string,
  item: RequestItem | null,
  envId: string | null,
  refresh: unknown[],
): { preview: RequestPreview | null; error: string | null } {
  const [preview, setPreview] = useState<RequestPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!root || !item) return;
    let live = true;
    const t = setTimeout(() => {
      previewRequest(root, item, envId)
        .then((p) => {
          if (!live) return;
          setPreview(p);
          setError(null);
        })
        .catch((e) => live && setError(String(e)));
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [root, item, envId, ...refresh]);
  return { preview, error };
}
