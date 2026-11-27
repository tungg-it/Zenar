import { Input, Select } from "antd";
import type { Auth } from "@/bindings/Auth";
import { VarInput } from "./VarInput";

// Like `fieldLabel`, without the margin: labels sit in the grid next to their field.
const label = "m-0 block text-sm text-z-muted";

const field = (v: string | undefined) => v ?? "";

/** `inherit` = no auth set at this level; `none` explicitly turns inherited auth off. */
export function AuthEditor({ auth, onChange, inheritLabel }: { auth: Auth | undefined; onChange: (a: Auth | undefined) => void; inheritLabel: string }) {
  const kind = auth?.type ?? "inherit";
  const patch = (p: Partial<Auth>) => onChange({ ...(auth as Auth), ...p });
  return (
    <div className="grid grid-cols-[120px_minmax(0,420px)] items-center gap-x-4 gap-y-2.5 pt-1 pb-3">
      <label className={label}>Auth type</label>
      <Select
        value={kind}
        style={{ width: 280 }}
        onChange={(v) => (v === "inherit" ? onChange(undefined) : onChange({ type: v }))}
        options={[
          { value: "inherit", label: inheritLabel },
          { value: "none", label: "No auth" },
          { value: "bearer", label: "Bearer token" },
          { value: "basic", label: "Basic" },
          { value: "apikey", label: "API key" },
        ]}
      />
      {auth?.type === "bearer" && (
        <>
          <label className={label}>Token</label>
          <VarInput mono placeholder="{{token}}" value={field(auth.token)} onChange={(token) => patch({ token })} />
        </>
      )}
      {auth?.type === "basic" && (
        <>
          <label className={label}>Username</label>
          <VarInput value={field(auth.username)} onChange={(username) => patch({ username })} />
          <label className={label}>Password</label>
          <Input.Password value={field(auth.password)} onChange={(e) => patch({ password: e.target.value })} />
        </>
      )}
      {auth?.type === "apikey" && (
        <>
          <label className={label}>Key</label>
          <VarInput value={field(auth.key)} onChange={(key) => patch({ key })} />
          <label className={label}>Value</label>
          <VarInput mono value={field(auth.value)} onChange={(value) => patch({ value })} />
          <label className={label}>Add to</label>
          <Select
            value={auth.in ?? "header"}
            style={{ width: 160 }}
            onChange={(v) => patch({ in: v })}
            options={[
              { value: "header", label: "Header" },
              { value: "query", label: "Query params" },
            ]}
          />
        </>
      )}
    </div>
  );
}
