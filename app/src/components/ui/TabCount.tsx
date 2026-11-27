/** Tab label with a count badge, e.g. "Headers 3". */
export const TabCount = ({ label, n }: { label: string; n: number }) => (
  <span>
    {label}
    {n > 0 && <span className="ml-1 text-xs text-z-get">{n}</span>}
  </span>
);
