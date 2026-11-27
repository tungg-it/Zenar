import { useMemo, useState } from "react";
import { Segmented } from "antd";
import { LuTriangleAlert } from "react-icons/lu";
import type { Scripts } from "@/bindings/Scripts";
import { syntaxError } from "@/libs/scripts";
import { CodeEditor } from "./CodeEditor";

const EVENTS = [
  { key: "pre_request", label: "Before request", placeholder: 'zn.environment.set("ts", Date.now());' },
  { key: "post_response", label: "After response", placeholder: 'zn.test("Status is 200", () => zn.response.to.have.status(200));' },
] as const;

const NO_SCRIPTS: Scripts = { pre_request: "", post_response: "" };

/** Scripts tab: one JavaScript editor per event, picked on the left like Postman. */
export function ScriptsEditor({ scripts, onChange }: { scripts: Scripts | undefined; onChange: (s: Scripts) => void }) {
  const value = { ...NO_SCRIPTS, ...scripts };
  const [event, setEvent] = useState<(typeof EVENTS)[number]["key"]>(value.pre_request.trim() || !value.post_response.trim() ? "pre_request" : "post_response");
  const current = EVENTS.find((e) => e.key === event)!;
  // Parsed (never run) on every edit, like Postman's editor lint: a typo shows before Send.
  const errors = useMemo(
    () => Object.fromEntries(EVENTS.map((e) => [e.key, value[e.key].trim() ? syntaxError(value[e.key]) : null])) as Record<(typeof EVENTS)[number]["key"], string | null>,
    [value.pre_request, value.post_response],
  );
  return (
    <div className="flex h-full gap-3 pb-3">
      <Segmented
        vertical
        className="flex-none self-start"
        value={event}
        onChange={setEvent}
        options={EVENTS.map((e) => ({
          value: e.key,
          label: (
            <span className="flex items-center justify-between gap-3 text-left">
              {e.label}
              {errors[e.key] ? (
                <span className="size-1.5 rounded-full bg-z-delete" aria-label="syntax error" />
              ) : (
                value[e.key].trim() && <span className="size-1.5 rounded-full bg-z-get" aria-label="has a script" />
              )}
            </span>
          ),
        }))}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <CodeEditor key={event} language="javascript" label={`${current.label} script`} value={value[event]} onChange={(code) => onChange({ ...value, [event]: code })} />
        {errors[event] && (
          <p className="mt-1.5 mb-0 flex items-center gap-2 font-mono text-code text-z-delete select-text" role="alert">
            <LuTriangleAlert className="flex-none" aria-hidden />
            {errors[event]}
          </p>
        )}
        <p className="mt-1.5 mb-0 text-sm text-z-faint">
          <code>zn</code> API (Postman's <code>pm</code> also works), e.g. <code className="font-mono">{current.placeholder}</code> <code>zn.environment.set</code> edits or adds a variable of the selected
          Environment (shared with the team; Secrets stay on your machine). <code>zn.variables.set</code> keeps a value on this machine only.
        </p>
      </div>
    </div>
  );
}
