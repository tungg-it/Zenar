import type { RequestItem } from "@/bindings/RequestItem";
import { fieldLabel } from "@/components/ui";
import { cx } from "@/libs/cx";
import { KeyValueEditor } from "./KeyValueEditor";

/**
 * Params tab, like Postman: Query Params, then Path Variables when the URL has `:name` segments.
 * Path Variable keys come from the URL, so only their values are edited here.
 */
export function ParamsEditor({ item, onChange }: { item: RequestItem; onChange: (r: RequestItem) => void }) {
  const vars = item.path_variables ?? [];
  return (
    <>
      <span className={fieldLabel}>Query Params</span>
      <KeyValueEditor rows={item.params} onChange={(params) => onChange({ ...item, params })} />
      {vars.length > 0 && (
        <>
          <span className={cx(fieldLabel, "mt-3")}>Path Variables</span>
          <KeyValueEditor fixedKeys rows={vars} onChange={(path_variables) => onChange({ ...item, path_variables })} />
        </>
      )}
    </>
  );
}
