// Running a Request's pre-request / post-response script in a throwaway Web Worker.
import type { ScriptInput, ScriptOutput } from "./script-sandbox";

export { syntaxError } from "./script-sandbox";
export type { ScriptEvent, ScriptInput, ScriptLog, ScriptOutput, ScriptRequest, TestResult } from "./script-sandbox";

/** A script still running after this is stopped (an endless loop must not hang Send). */
export const SCRIPT_TIMEOUT_MS = 10_000;

export function runScript(input: ScriptInput): Promise<ScriptOutput> {
  const failed = (error: string): ScriptOutput => ({ set: {}, unset: [], envSet: {}, envUnset: [], request: input.request, logs: [], tests: [], error });
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./script-worker.ts", import.meta.url), { type: "module" });
    const done = (out: ScriptOutput) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(out);
    };
    const timer = setTimeout(() => done(failed(`Script timed out after ${SCRIPT_TIMEOUT_MS / 1000} s`)), SCRIPT_TIMEOUT_MS);
    worker.onmessage = (e: MessageEvent<ScriptOutput>) => done(e.data);
    // A syntax error in the script is caught inside the worker; this is the worker itself failing.
    worker.onerror = (e) => {
      e.preventDefault();
      done(failed(e.message || "Script could not run"));
    };
    worker.postMessage(input);
  });
}
