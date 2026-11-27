import { cx } from "@/libs/cx";

const COLOR: Record<string, string> = {
  GET: "text-z-get",
  POST: "text-z-post",
  PUT: "text-z-put",
  PATCH: "text-z-patch",
  DELETE: "text-z-delete",
  GQL: "text-z-graphql",
};

/** A GraphQL Request (New → GraphQL): `kind: graphql` among the file's top-level fields. */
export const isGraphql = (r: { extra?: Record<string, unknown> | null }) => r.extra?.kind === "graphql";

/** What a Request's tag says: its method, or GQL for a GraphQL Request (always a POST). */
export const requestTag = (r: { method: string; extra?: Record<string, unknown> | null }) => (isGraphql(r) ? "GQL" : r.method);

/** Coloured HTTP method label, as in the sidebar and tabs. */
export function MethodTag({ method, compact = false }: { method: string; compact?: boolean }) {
  const m = method.toUpperCase();
  return (
    <span
      className={cx(
        "flex-none font-mono font-bold tracking-[0.02em]",
        COLOR[m] ?? "text-z-other",
        compact ? "w-[30px] text-left text-[9.5px]" : "text-xs",
      )}
    >
      {compact && m === "DELETE" ? "DEL" : m}
    </span>
  );
}
