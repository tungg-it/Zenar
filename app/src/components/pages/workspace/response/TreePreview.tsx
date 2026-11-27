import { LuChevronRight } from "react-icons/lu";
import { JsonPreview } from "./JsonPreview";

/**
 * Preview of a parsed XML or YAML body like Postman's: a "Root › <root element>" breadcrumb (just "Root" for YAML)
 * above the data as collapsed key/value tables.
 */
export function TreePreview({ root, value }: { root?: string; value: unknown }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1.5 flex items-center gap-1 text-base">
        <span className={root ? "text-z-faint" : "font-semibold text-z-text"}>Root</span>
        {root && (
          <>
            <LuChevronRight className="text-z-faint" aria-hidden />
            <span className="font-semibold text-z-text select-text">{root}</span>
          </>
        )}
      </div>
      <JsonPreview data={value} openDepth={0} />
    </div>
  );
}
