// Send with the Request's scripts: pre-request script, Send, post-response script. Scripts run in a
// Web Worker (`libs/scripts`). `zn.environment` writes go to the active Environment (Secrets stay on
// this machine); the other scopes write Captured Variables of this machine.
import type { EnvironmentItem } from "@/bindings/EnvironmentItem";
import type { HttpResponse } from "@/bindings/HttpResponse";
import type { RequestItem } from "@/bindings/RequestItem";
import { runScript, type ScriptEvent, type ScriptLog, type ScriptOutput, type TestResult } from "@/libs/scripts";
import { splitPathVariables, splitUrlParams, urlWithParams } from "@/libs/url-params";
import { saveEnvironment, setSecretValue } from "@/service/environment";
import { applyScriptVars, previewRequest, sendComposed } from "./runner.api";

export type ScriptReport = {
  logs: (ScriptLog & { event: ScriptEvent })[];
  tests: TestResult[];
  errors: { event: ScriptEvent; message: string }[];
};

export const EMPTY_REPORT: ScriptReport = { logs: [], tests: [], errors: [] };

/** Where `zn.environment` writes go: the active Environment, unless there is none or the Collection is read-only. */
export type ScriptTarget = { root: string; environment: EnvironmentItem | null; readOnly: boolean };

/** Environment + Captured Variables as the next compose will see them. */
async function variables(target: ScriptTarget, item: RequestItem) {
  const { variables } = await previewRequest(target.root, item, target.environment?.id ?? null);
  return Object.fromEntries(variables.map((v) => [v.name, v.value]));
}

/**
 * Saves `zn.environment` writes into the active Environment: an existing variable is edited, a new
 * name is added, `unset` removes it. Secrets are stored on this machine. A Captured Variable of the same name
 * would hide the new value, so it is removed. Returns whether the shared Environment was saved.
 */
async function saveToEnvironment(target: ScriptTarget, out: ScriptOutput, event: ScriptEvent, report: ScriptReport): Promise<boolean> {
  const env = target.environment!;
  const secrets = env.variables.filter((v) => v.secret);
  for (const [key, value] of Object.entries(out.envSet)) {
    const secret = secrets.find((v) => v.key === key);
    if (secret) await setSecretValue(target.root, env.id, secret.id, value);
  }
  let variables = env.variables
    .filter((v) => v.secret || !out.envUnset.includes(v.key))
    .map((v) => (!v.secret && v.key in out.envSet ? { ...v, value: out.envSet[v.key] } : v));
  for (const [key, value] of Object.entries(out.envSet))
    if (!variables.some((v) => v.key === key)) variables = [...variables, { id: crypto.randomUUID(), key, value, secret: false }];
  const changed = variables.length !== env.variables.length || variables.some((v, i) => v.key !== env.variables[i].key || (!v.secret && v.value !== env.variables[i].value));
  const hidden = [...Object.keys(out.envSet), ...out.envUnset];
  await applyScriptVars(target.root, {}, hidden);
  if (!changed) return false;
  const result = await saveEnvironment(target.root, env, { ...env, variables });
  if (result.status === "conflict") {
    report.errors.push({ event, message: `Someone else changed ${result.fields.join(", ")} in ${env.name}; the script's values were not saved.` });
    return false;
  }
  target.environment = { ...env, variables };
  return true;
}

async function run(event: ScriptEvent, code: string, target: ScriptTarget, item: RequestItem, report: ScriptReport, response?: HttpResponse) {
  const out = await runScript({
    event,
    code,
    requestName: item.name,
    vars: await variables(target, item),
    request: { method: item.method, url: urlWithParams(item.url, item.params), headers: item.headers, body: item.body },
    response,
  });
  report.logs.push(...out.logs.map((l) => ({ ...l, event })));
  report.tests.push(...out.tests);
  if (out.error) report.errors.push({ event, message: out.error });
  let set = out.set;
  let unset = out.unset;
  let savedEnvironment = false;
  if (Object.keys(out.envSet).length > 0 || out.envUnset.length > 0) {
    if (target.environment && !target.readOnly) {
      savedEnvironment = await saveToEnvironment(target, out, event, report);
    } else {
      // Nowhere shared to write: keep the values on this machine so later Requests still get them.
      report.logs.push({ event, level: "warn", text: `${target.environment ? "This Collection is read-only" : "No Environment selected"}: zn.environment values were saved as Captured Variables.` });
      set = { ...set, ...out.envSet };
      unset = [...unset, ...out.envUnset];
    }
  }
  if (Object.keys(set).length > 0 || unset.length > 0) await applyScriptVars(target.root, set, unset);
  return { out, savedEnvironment };
}

/**
 * Runs the pre-request script, sends the Request as the script left it (the saved Request is not
 * changed), then runs the post-response script. A pre-request script error stops the Send, like
 * Postman. `onResponse` gets the response (and the pre-request report) before the post-response
 * script runs, so it can be shown without waiting for the script. `error` is the reason no response
 * came back; `environmentChanged` asks for a reload.
 */
export async function sendScripted(
  root: string,
  item: RequestItem,
  environment: EnvironmentItem | null,
  readOnly: boolean,
  onResponse?: (response: HttpResponse, report: ScriptReport) => void,
): Promise<{ response: HttpResponse | null; report: ScriptReport; error: string | null; environmentChanged: boolean }> {
  const report: ScriptReport = { logs: [], tests: [], errors: [] };
  const target: ScriptTarget = { root, environment, readOnly };
  const { pre_request = "", post_response = "" } = item.scripts ?? {};
  let environmentChanged = false;
  let sent = item;
  if (pre_request.trim()) {
    const { out, savedEnvironment } = await run("pre-request", pre_request, target, item, report);
    environmentChanged ||= savedEnvironment;
    if (out.error) return { response: null, report, error: `Error in pre-request script: ${out.error}`, environmentChanged };
    const query = out.request.url === urlWithParams(item.url, item.params) ? { url: item.url, params: item.params } : splitUrlParams(out.request.url, item.params);
    sent = { ...item, ...query, ...splitPathVariables(query.url, item.path_variables), method: out.request.method, headers: out.request.headers };
  }
  let response: HttpResponse;
  try {
    response = await sendComposed(root, sent, environment?.id ?? null);
  } catch (e) {
    return { response: null, report, error: String(e), environmentChanged };
  }
  onResponse?.(response, { logs: [...report.logs], tests: [...report.tests], errors: [...report.errors] });
  if (post_response.trim()) environmentChanged ||= (await run("post-response", post_response, target, sent, report, response)).savedEnvironment;
  return { response, report, error: null, environmentChanged };
}
