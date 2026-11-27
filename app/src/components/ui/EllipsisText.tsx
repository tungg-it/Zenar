import { useRef, useState } from "react";
import { Tooltip, type TooltipProps } from "antd";

/** One-line text cut with "…"; hovering shows the full text, but only when it is actually cut. */
export function EllipsisText({
  text,
  className,
  placement,
}: {
  text: string;
  className?: string;
  placement?: TooltipProps["placement"];
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const clipped = () => !!ref.current && ref.current.scrollWidth > ref.current.clientWidth;
  return (
    <Tooltip title={text} open={open} onOpenChange={(o) => setOpen(o && clipped())} placement={placement} mouseEnterDelay={0.4}>
      <span ref={ref} className={className}>
        {text}
      </span>
    </Tooltip>
  );
}
