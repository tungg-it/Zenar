import { useEffect, useState } from "react";
import { setZoomLevel, zoomLevel } from "@/libs/prefs";
import { setWebviewZoom } from "@/service/view";

// The steps browsers use.
// "100%" draws the interface a little larger than the webview's own 100%, which reads small on desktop.
const BASE_SCALE = 1.1;
const STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** Interface zoom, remembered on this machine and applied at start. Each change returns the new level. */
export function useZoom(): { zoom: number; zoomIn: () => number; zoomOut: () => number; resetZoom: () => number } {
  const [zoom, setZoom] = useState(zoomLevel);
  useEffect(() => {
    setWebviewZoom(zoom * BASE_SCALE).catch(() => {});
    setZoomLevel(zoom);
  }, [zoom]);
  const to = (z: number) => {
    setZoom(z);
    return z;
  };
  return {
    zoom,
    zoomIn: () => to(STEPS.find((s) => s > zoom + 0.001) ?? zoom),
    zoomOut: () => to([...STEPS].reverse().find((s) => s < zoom - 0.001) ?? zoom),
    resetZoom: () => to(1),
  };
}
