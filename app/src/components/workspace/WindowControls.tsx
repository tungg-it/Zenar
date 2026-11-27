import { useEffect, useState } from "react";
import { LuCopy, LuMinus, LuSquare, LuX } from "react-icons/lu";
import { cx } from "@/libs/cx";
import { closeWindow, isWindowMaximized, minimizeWindow, onWindowResized, toggleMaximizeWindow } from "@/service/window";

const caption = "inline-flex h-full w-[46px] cursor-default appearance-none items-center justify-center rounded-none border-0 bg-transparent p-0 text-z-text outline-none transition-colors";

/** Minimize / Maximize (Restore) / Close at the right of the title bar, for Windows and Linux where the window has no native frame. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const sync = () => void isWindowMaximized().then(setMaximized);
    sync();
    const off = onWindowResized(sync);
    return () => void off.then((f) => f());
  }, []);

  const restoreLabel = maximized ? "Restore Down" : "Maximize";
  return (
    <div className="flex h-full flex-none items-stretch">
      <button type="button" aria-label="Minimize" title="Minimize" onClick={() => void minimizeWindow()} className={cx(caption, "hover:bg-z-active focus-visible:bg-z-active")}>
        <LuMinus size={15} aria-hidden />
      </button>
      <button type="button" aria-label={restoreLabel} title={restoreLabel} onClick={() => void toggleMaximizeWindow()} className={cx(caption, "hover:bg-z-active focus-visible:bg-z-active")}>
        {maximized ? <LuCopy size={13} className="-scale-x-100" aria-hidden /> : <LuSquare size={12} aria-hidden />}
      </button>
      <button
        type="button"
        aria-label="Close"
        title="Close"
        onClick={() => void closeWindow()}
        className={cx(caption, "hover:bg-z-close-hover hover:text-z-on-close-hover focus-visible:bg-z-close-hover focus-visible:text-z-on-close-hover")}
      >
        <LuX size={16} aria-hidden />
      </button>
    </div>
  );
}
