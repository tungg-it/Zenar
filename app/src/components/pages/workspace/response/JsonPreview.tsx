import { useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Levels open at first by default; deeper objects start collapsed so large bodies stay fast. */
const OPEN_DEPTH = 3;

const isBranch = (v: Json): v is Json[] | { [k: string]: Json } => v !== null && typeof v === "object";

const size = (v: Json[] | { [k: string]: Json }) => (Array.isArray(v) ? `[${v.length}]` : `{${Object.keys(v).length}}`);

function Scalar({ value }: { value: Exclude<Json, object> }) {
  if (value === null) return <span className="text-z-faint italic">null</span>;
  return <span>{String(value)}</span>;
}

type Level = { depth: number; openDepth: number };

function Branch({ name, value, depth, openDepth }: { name: string; value: Json[] | { [k: string]: Json } } & Level) {
  const [open, setOpen] = useState(depth < openDepth);
  return (
    <>
      <tr>
        <td colSpan={2} className="p-0!">
          <button
            className="inline-flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent py-1.5 pr-2 pl-3 text-left [font:inherit] text-z-text hover:bg-z-hover [&>svg]:text-z-muted" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? <LuChevronDown /> : <LuChevronRight />}
            <span className="ml-1 font-semibold">{name}</span>
            <span className="rounded-[3px] bg-z-active px-[5px] font-mono text-xs text-z-muted">{size(value)}</span>
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={2} className="border-b-0! py-0! pr-0! pl-[72px]! [&>table]:border-0 [&>table]:border-l">
            <JsonTable value={value} depth={depth + 1} openDepth={openDepth} />
          </td>
        </tr>
      )}
    </>
  );
}

function JsonTable({ value, depth, openDepth }: { value: Json[] | { [k: string]: Json } } & Level) {
  const entries: [string, Json][] = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
  if (entries.length === 0) return <p className="mx-2 my-1.5 text-z-faint">{Array.isArray(value) ? "Empty array" : "Empty object"}</p>;
  return (
    <table className="w-full border-collapse border border-z-border [&_:is(td,th)]:border-b [&_:is(td,th)]:border-z-border [&_:is(td,th)]:px-2 [&_:is(td,th)]:py-[5px] [&_:is(td,th)]:text-left [&_:is(td,th)]:align-top [&_td]:break-words [&_td]:text-z-muted [&_td]:select-text [&_th]:w-[1%] [&_th]:border-r [&_th]:font-semibold [&_th]:whitespace-nowrap [&_th]:text-z-text">
      <tbody>
        {entries.map(([k, v]) =>
          isBranch(v) ? (
            <Branch key={k} name={k} value={v} depth={depth} openDepth={openDepth} />
          ) : (
            <tr key={k}>
              <th scope="row">
                {k}
              </th>
              <td>
                <Scalar value={v} />
              </td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

/** Preview of a JSON body as nested key/value tables, objects and arrays collapsible; `openDepth` levels start open. */
export function JsonPreview({ data, openDepth = OPEN_DEPTH }: { data: unknown; openDepth?: number }) {
  const v = data as Json;
  return <div className="min-h-0 flex-1 overflow-auto text-base">{isBranch(v) ? <JsonTable value={v} depth={0} openDepth={openDepth} /> : <Scalar value={v} />}</div>;
}
