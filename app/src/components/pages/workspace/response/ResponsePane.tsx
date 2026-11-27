import { useEffect, useState } from "react";
import { App as AntApp, Button, Empty, Spin, Tabs, Tooltip } from "antd";
import { LuCopy, LuSend, LuTriangleAlert, LuUnplug } from "react-icons/lu";
import type { HttpResponse } from "@/bindings/HttpResponse";
import { formatSize } from "@/libs/format";
import { statusClass, statusText, type StatusClass } from "@/libs/http";
import { cx } from "@/libs/cx";
import { KvRow, KvTable, requestTabs, TabCount } from "@/components/ui";
import { ResponseBody } from "./ResponseBody";
import { ResponseCookies } from "./ResponseCookies";
import { ScriptConsole } from "./ScriptConsole";
import type { ScriptReport } from "@/service/runner";

const STATUS_COLOR: Record<StatusClass, string> = {
  success: "bg-z-get/16 text-z-get",
  redirect: "bg-z-put/16 text-z-put",
  info: "bg-z-put/16 text-z-put",
  "client-error": "bg-z-post/16 text-z-post",
  "server-error": "bg-z-delete/16 text-z-delete",
};

const pane = "flex min-h-[160px] flex-1 flex-col border-t border-z-border px-4 pb-2";
/** Sending, failed or nothing sent yet: centred content under a "Response" label. */
const emptyPane = cx(pane, "relative items-center justify-center gap-2 text-z-muted [&_.ant-empty-image]:text-z-faint");
const paneLabel = "absolute top-0 left-4 py-2 font-semibold text-z-text";

/** What to check next, from the shape of the error message (the backend names the cause). */
function hintFor(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("refused")) return "Nothing is listening at that address. Check that the server is running and the host and port are right.";
  if (m.includes("timed out")) return "The server did not answer in time. Check the URL, your network, or the proxy in Settings.";
  if (m.includes("dns") || m.includes("lookup") || m.includes("not known")) return "The host name could not be found. Check the spelling of the URL or your network.";
  if (m.includes("certificate") || m.includes("tls") || m.includes("ssl"))
    return "The TLS certificate was rejected. For a self-signed certificate, turn on “Skip TLS certificate verification” in Settings.";
  if (m.includes("script")) return "Fix the script in the Request's Scripts tab, then send again.";
  if (m.includes("unresolved variable") || m.includes("variable")) return "A {{variable}} has no value. Pick an Environment or fill in its Secrets.";
  if (m.includes("invalid")) return "Check the URL, method and header names of this Request.";
  return "Check the URL and your connection, then send again.";
}

/** Bottom half of the request view: sending state, a send failure, or the status line with Body / Headers. */
export function ResponsePane({
  response,
  error,
  sending,
  scripts,
  scriptRunning,
}: {
  response: HttpResponse | null;
  error: string | null;
  sending: boolean;
  /** What the Request's scripts logged and tested during this Send. */
  scripts: ScriptReport;
  /** The post-response script is still running; `scripts` will grow when it ends. */
  scriptRunning: boolean;
}) {
  const { message } = AntApp.useApp();
  const [tab, setTab] = useState("body");
  // A script that failed opens the Console, so the error is not missed.
  useEffect(() => {
    if (scripts.errors.length > 0) setTab("console");
  }, [scripts]);

  if (sending) {
    return (
      <section className={emptyPane} aria-label="Response" aria-busy>
        <div className={paneLabel}>Response</div>
        <Spin />
        <p className="text-z-muted">Sending request…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className={emptyPane} aria-label="Response">
        <div className={paneLabel}>Response</div>
        <div className="flex max-w-[640px] flex-col items-center gap-2.5 text-center" role="alert">
          <LuUnplug className="size-14 text-z-faint" aria-hidden />
          <p className="m-0 text-md text-z-text">Could not send request</p>
          <div className="flex items-center gap-2.5 rounded border border-z-delete/35 bg-z-delete/14 py-1.5 pr-2 pl-3 text-left text-z-delete">
            <LuTriangleAlert className="flex-none" aria-hidden />
            <span className="font-mono text-code break-words text-z-text select-text">
              <b className="text-z-delete">Error:</b> {error}
            </span>
            <Tooltip title="Copy error">
              <Button
                type="text"
                size="small"
                aria-label="Copy error"
                icon={<LuCopy />}
                onClick={() => navigator.clipboard?.writeText(error).then(() => message.success("Copied"), () => {})}
              />
            </Tooltip>
          </div>
          <p className="m-0 text-sm text-z-muted">{hintFor(error)}</p>
        </div>
      </section>
    );
  }

  if (!response) {
    return (
      <section className={emptyPane} aria-label="Response">
        <div className={paneLabel}>Response</div>
        <Empty image={<LuSend size={40} />} description="Click Send to get a response" />
      </section>
    );
  }

  const contentType = response.headers.find((h) => h.key.toLowerCase() === "content-type")?.value;
  const passed = scripts.tests.filter((t) => t.passed).length;
  const cookieCount = response.headers.filter((h) => h.key.toLowerCase() === "set-cookie").length;
  const hasConsole = scripts.logs.length > 0 || scripts.tests.length > 0 || scripts.errors.length > 0;
  // The last Send may not have the Console tab that was open: fall back to Body.
  const active = tab === "console" && !hasConsole ? "body" : tab;
  return (
    <section className={pane} aria-label="Response">
      {/* Flex all the way down (Ant v6: body-holder > body > content-active; no % heights): the active tab gets the
          height left and scrolls itself; the Body's code view scrolls inside it. Only `-active` gets `flex`, so the
          hidden tabs keep Ant's `display: none`. */}
      <Tabs
        className={cx(requestTabs, "flex min-h-0 flex-1 flex-col [&>.ant-tabs-body-holder]:flex [&>.ant-tabs-body-holder]:flex-col [&>.ant-tabs-body-holder>.ant-tabs-body]:flex [&>.ant-tabs-body-holder>.ant-tabs-body]:min-h-0 [&>.ant-tabs-body-holder>.ant-tabs-body]:flex-1 [&>.ant-tabs-body-holder>.ant-tabs-body]:flex-col [&_.ant-tabs-content-active]:flex [&_.ant-tabs-content-active]:min-h-0 [&_.ant-tabs-content-active]:flex-1 [&_.ant-tabs-content-active]:flex-col [&_.ant-tabs-content-active]:overflow-auto")}
        tabBarExtraContent={
          <div className="flex items-center gap-3 text-sm text-z-muted">
            {scriptRunning && (
              <>
                <span className="flex items-center gap-1.5" role="status">
                  <Spin size="small" />
                  Running script…
                </span>
                <span className="text-z-faint" aria-hidden>•</span>
              </>
            )}
            <span className={cx("rounded-[3px] px-1.5 py-px text-sm font-semibold", STATUS_COLOR[statusClass(response.status)])}>{statusText(response.status)}</span>
            <span className="text-z-faint" aria-hidden>•</span>
            <Tooltip title="Total time">
              <span>{response.time_ms} ms</span>
            </Tooltip>
            <span className="text-z-faint" aria-hidden>•</span>
            <Tooltip title="Body size">
              <span>{formatSize(response.size_bytes)}</span>
            </Tooltip>
          </div>
        }
        activeKey={active}
        onChange={setTab}
        items={[
          { key: "body", label: "Body", children: <ResponseBody body={response.body} contentType={contentType} /> },
          { key: "cookies", label: <TabCount label="Cookies" n={cookieCount} />, children: <ResponseCookies headers={response.headers} /> },
          {
            key: "headers",
            label: <TabCount label="Headers" n={response.headers.length} />,
            children: (
              <KvTable>
                <KvRow columns="readonly" head>
                  <span>Key</span>
                  <span>Value</span>
                </KvRow>
                {response.headers.map((h, i) => (
                  <KvRow columns="readonly" key={i}>
                    <span className="font-medium">{h.key}</span>
                    <span className="font-mono text-code">{h.value}</span>
                  </KvRow>
                ))}
              </KvTable>
            ),
          },
          ...(hasConsole
            ? [
                {
                  key: "console",
                  label: (
                    // "Console 2/3" (tests passed, red when one failed), a red dot when a script failed.
                    <span>
                      Console
                      {scripts.tests.length > 0 && (
                        <span className={cx("ml-1 text-xs", passed === scripts.tests.length ? "text-z-get" : "text-z-delete")}>
                          {passed}/{scripts.tests.length}
                        </span>
                      )}
                      {scripts.errors.length > 0 && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-z-delete align-middle" aria-label="script error" />}
                    </span>
                  ),
                  children: <ScriptConsole report={scripts} />,
                },
              ]
            : []),
        ]}
      />
    </section>
  );
}
