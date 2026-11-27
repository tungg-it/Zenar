import { Empty } from "antd";
import { LuOctagonAlert } from "react-icons/lu";
import type { ScriptReport } from "@/service/runner";
import { cx } from "@/libs/cx";
import { TestResults } from "./TestResults";

const LEVEL_CLASS = { log: "text-z-text", info: "text-z-text", warn: "text-z-put", error: "text-z-delete" } as const;
const EVENT_LABEL = { "pre-request": "Before request", "post-response": "After response" } as const;

/** "TypeError: x is undefined" → name in bold, then the message; other errors (e.g. a save conflict) as they are. */
function ErrorText({ message }: { message: string }) {
  const m = /^(\w*Error): ([\s\S]*)$/.exec(message);
  return m ? (
    <>
      <b>{m[1]}:</b> {m[2]}
    </>
  ) : (
    <>{message}</>
  );
}

/** Like Postman: a script that could not run, said up front. */
function ScriptError({ error }: { error: ScriptReport["errors"][number] }) {
  return (
    <div role="alert" className="mb-2 flex flex-col gap-2 rounded border border-z-delete/35 bg-z-delete/14 px-3 py-2.5">
      <div className="flex items-center gap-2 text-z-text">
        <LuOctagonAlert className="flex-none text-z-delete" aria-hidden />
        Couldn't evaluate the {EVENT_LABEL[error.event]} script
      </div>
      <div className="rounded-[3px] bg-z-delete/20 px-2 py-1 font-mono text-code break-words text-z-text select-text">
        <ErrorText message={error.message} />
      </div>
    </div>
  );
}

/** What the scripts left: uncaught errors first, then `zn.test` results, then `console.*` output in the order it ran. */
export function ScriptConsole({ report }: { report: ScriptReport }) {
  const { logs, tests, errors } = report;
  if (logs.length === 0 && tests.length === 0 && errors.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing logged by the scripts." />;
  return (
    <div className="flex flex-col pt-1">
      {errors.map((e, i) => (
        <ScriptError key={i} error={e} />
      ))}
      {tests.length > 0 && (
        <div className={cx(logs.length > 0 && "mb-3")}>
          <TestResults tests={tests} />
        </div>
      )}
      {logs.length > 0 && (
        <div className="font-mono text-code">
          {logs.map((l, i) => (
            <div key={i} className="flex gap-3 border-t border-z-border py-1">
              <span className="w-28 flex-none text-z-faint">{EVENT_LABEL[l.event]}</span>
              <span className={cx("min-w-0 break-words whitespace-pre-wrap select-text", LEVEL_CLASS[l.level])}>{l.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
