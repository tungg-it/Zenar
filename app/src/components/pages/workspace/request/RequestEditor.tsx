import { useCallback, useMemo, useState } from "react";
import { App, Button, Input, Select, Space, Tabs, Tooltip } from "antd";
import { LuSave, LuSend } from "react-icons/lu";
import type { HttpResponse } from "@/bindings/HttpResponse";
import type { KeyValue } from "@/bindings/KeyValue";
import type { PreviewVar } from "@/bindings/PreviewVar";
import type { RequestItem } from "@/bindings/RequestItem";
import { AuthEditor } from "./AuthEditor";
import { BodyEditor } from "./BodyEditor";
import { CapturesEditor } from "./CapturesEditor";
import { GraphqlQuery, GraphqlSchemaTab, isGraphql, useGraphqlSchema } from "./GraphqlEditor";
import { HasVariable, VariableOptions } from "./has-variable";
import { KeyValueEditor } from "./KeyValueEditor";
import { ParamsEditor } from "./ParamsEditor";
import { ScriptsEditor } from "./ScriptsEditor";
import { UrlInput } from "./UrlInput";
import { MethodTag, requestTabs, TabCount } from "@/components/ui";
import { cx } from "@/libs/cx";
import { SHORTCUTS } from "@/libs/keys";
import { splitPathVariables, splitUrlParams, urlWithParams } from "@/libs/url-params";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export function RequestEditor({
  item,
  crumbs,
  onChange,
  onSend,
  onSave,
  dirty,
  sending = false,
  saving = false,
  readOnly = false,
  variables,
  isSecret,
  introspect,
}: {
  item: RequestItem;
  /** Collection / Folder names above the Request, shown as a breadcrumb. */
  crumbs: string[];
  onChange: (r: RequestItem) => void;
  onSend: () => void;
  onSave: () => void;
  dirty: boolean;
  sending?: boolean;
  saving?: boolean;
  /** This Collection needs a newer app: Requests can be run but not Saved. */
  readOnly?: boolean;
  /** Variables available to this Request (Environment + Captured), or undefined while loading. */
  variables?: PreviewVar[];
  /** Whether `{{name}}` is a Secret of the active Environment: its value stays hidden in suggestions. */
  isSecret?: (name: string) => boolean;
  /** Send a variant of this Request as is (no scripts): the GraphQL Schema's introspection query. */
  introspect?: (r: RequestItem) => Promise<HttpResponse>;
}) {
  const { message } = App.useApp();
  const [tab, setTab] = useState("params");
  const graphql = isGraphql(item);
  const schema = useGraphqlSchema(item, introspect);
  // The name in the breadcrumb is being edited (click it, like Postman). Saved with the Request.
  const [renaming, setRenaming] = useState(false);
  // Until the variables are known, nothing shows as missing.
  const hasVariable = useCallback((name: string) => !variables || variables.some((v) => v.name === name), [variables]);
  const options = useMemo(
    () => (variables ?? []).map((v) => ({ ...v, secret: v.source === "environment" && !!isSecret?.(v.name) })),
    [variables, isSecret],
  );
  const enabled = (l: KeyValue[]) => l.filter((r) => r.enabled && r.key).length;
  // URL bar text as typed: rebuilding it from url + params would eat a trailing
  // "?" or "=" mid-typing. Rebuilt when url / Params / Path Variables change from elsewhere, or on blur.
  const [typed, setTyped] = useState<{ text: string; item: RequestItem } | null>(null);
  const same = (a: RequestItem, b: RequestItem) => a.url === b.url && a.params === b.params && a.path_variables === b.path_variables;
  const urlText = typed && same(typed.item, item) ? typed.text : urlWithParams(item.url, item.params);
  const onUrlChange = (text: string) => {
    const query = splitUrlParams(text, item.params);
    const next = { ...item, ...query, ...splitPathVariables(query.url, item.path_variables ?? []) };
    setTyped({ text, item: next });
    onChange(next);
  };
  const dot = (label: string) => <span className="ml-1.5 inline-block size-1.5 rounded-full bg-z-get align-middle" aria-label={label} />;
  const common = {
    auth: {
      key: "auth",
      label: "Authorization",
      children: <AuthEditor auth={item.auth ?? undefined} inheritLabel="Inherit auth from parent" onChange={(auth) => onChange({ ...item, auth })} />,
    },
    headers: { key: "headers", label: <TabCount label="Headers" n={enabled(item.headers)} />, children: <KeyValueEditor rows={item.headers} onChange={(headers) => onChange({ ...item, headers })} /> },
    scripts: {
      key: "scripts",
      label: (
        <span>
          Scripts
          {(item.scripts?.pre_request?.trim() || item.scripts?.post_response?.trim()) && dot("has a script")}
        </span>
      ),
      children: <ScriptsEditor scripts={item.scripts} onChange={(scripts) => onChange({ ...item, scripts })} />,
    },
    captures: {
      key: "captures",
      label: <TabCount label="Captures" n={item.captures.length} />,
      children: <CapturesEditor rows={item.captures} onChange={(captures) => onChange({ ...item, captures })} />,
    },
  };
  // Postman's tabs for each kind: a GraphQL Request has Query and Schema instead of Params and Body.
  const tabs = graphql
    ? [
        { key: "query", label: "Query", children: <GraphqlQuery item={item} onChange={onChange} schema={schema} /> },
        common.auth,
        common.headers,
        { key: "schema", label: <span>Schema{schema.schema && dot("schema loaded")}</span>, children: <GraphqlSchemaTab schema={schema} /> },
        common.scripts,
        common.captures,
      ]
    : [
        { key: "params", label: <TabCount label="Params" n={enabled(item.params)} />, children: <ParamsEditor item={item} onChange={onChange} /> },
        common.auth,
        common.headers,
        { key: "body", label: <span>Body{item.body_type && dot("has a body")}</span>, children: <BodyEditor item={item} onChange={onChange} /> },
        common.scripts,
        common.captures,
      ];
  return (
    <HasVariable.Provider value={hasVariable}>
    <VariableOptions.Provider value={options}>
    <div className="max-h-[60%] min-h-0 flex-initial overflow-auto px-4 pt-2.5 group-[.is-sized]/split:flex group-[.is-sized]/split:h-(--editor-h) group-[.is-sized]/split:max-h-[calc(100%-160px)] group-[.is-sized]/split:flex-col">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0 truncate">
          {crumbs.map((c, i) => (
            <span key={i} className="text-z-muted">
              {c} <span className="mx-1 text-z-faint">/</span>
            </span>
          ))}
          {renaming ? (
            <Input
              size="small"
              autoFocus
              className="w-64 font-semibold"
              defaultValue={item.name}
              placeholder="Request name"
              aria-label="Request name"
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  e.currentTarget.value = item.name;
                  e.currentTarget.blur();
                }
              }}
              onBlur={(e) => {
                setRenaming(false);
                const name = e.currentTarget.value.trim();
                if (name && name !== item.name) onChange({ ...item, name });
              }}
            />
          ) : (
            <Tooltip title={readOnly ? undefined : "Rename"}>
              <span
                role={readOnly ? undefined : "button"}
                tabIndex={readOnly ? undefined : 0}
                className={cx("rounded px-1 py-0.5 font-semibold", !readOnly && "cursor-text hover:bg-z-hover focus-visible:outline-2 focus-visible:outline-z-link")}
                onClick={() => !readOnly && setRenaming(true)}
                onKeyDown={(e) => !readOnly && (e.key === "Enter" || e.key === "F2") && setRenaming(true)}
              >
                {item.name}
              </span>
            </Tooltip>
          )}
        </div>
        <Tooltip title={readOnly ? "This Collection is read-only" : `Save (${SHORTCUTS.save}), shares with every Member`}>
          <Button icon={<LuSave />} onClick={onSave} loading={saving} disabled={!dirty || readOnly}>
            Save
          </Button>
        </Tooltip>
      </div>
      <Space.Compact className="mb-1" block>
        {/* A GraphQL Request is always a POST. */}
        {!graphql && (
          <Select
            value={item.method}
            className="w-28"
            popupMatchSelectWidth={false}
            onChange={(method) => onChange({ ...item, method })}
            options={METHODS.map((m) => ({ value: m, label: <MethodTag method={m} /> }))}
            aria-label="Method"
          />
        )}
        <UrlInput
          value={urlText}
          onChange={onUrlChange}
          onBlur={() => setTyped(null)}
          onPasteCurl={(curl) => {
            // Like Postman: the command replaces the Request's method, URL, Params, headers and body.
            setTyped(null);
            onChange({ ...item, ...curl, auth: curl.auth ?? item.auth });
            message.success("Imported from cURL");
          }}
          // ⌘↵ / Ctrl+Enter is the Send shortcut, handled app-wide: don't send twice.
          onPressEnter={(e) => !(e.metaKey || e.ctrlKey) && onSend()}
          hasPathValue={(name) => !!item.path_variables?.find((v) => v.key === name)?.value}
        />
        <Button type="primary" icon={graphql ? undefined : <LuSend />} onClick={onSend} loading={sending} className="min-w-[92px]">
          {graphql ? "Query" : "Send"}
        </Button>
      </Space.Compact>
      <Tabs
        activeKey={tabs.some((t) => t.key === tab) ? tab : tabs[0].key}
        onChange={setTab}
        // Dragged to a size: the tabs take the rest of the height, the open tab scrolls on its own and
        // the Body / Scripts editors (CodeEditor) stretch to fill it.
        className={cx(
          requestTabs,
          // Flex down Ant v6's body-holder > body > content-active (no % heights); only the active tab gets `flex`
          // so the hidden ones keep `display: none`.
          "group-[.is-sized]/split:min-h-0 group-[.is-sized]/split:flex-1 group-[.is-sized]/split:[&>.ant-tabs-body-holder]:flex group-[.is-sized]/split:[&>.ant-tabs-body-holder]:flex-col group-[.is-sized]/split:[&>.ant-tabs-body-holder>.ant-tabs-body]:flex group-[.is-sized]/split:[&>.ant-tabs-body-holder>.ant-tabs-body]:min-h-0 group-[.is-sized]/split:[&>.ant-tabs-body-holder>.ant-tabs-body]:flex-1 group-[.is-sized]/split:[&>.ant-tabs-body-holder>.ant-tabs-body]:flex-col group-[.is-sized]/split:[&_.ant-tabs-content-active]:flex group-[.is-sized]/split:[&_.ant-tabs-content-active]:min-h-0 group-[.is-sized]/split:[&_.ant-tabs-content-active]:flex-1 group-[.is-sized]/split:[&_.ant-tabs-content-active]:flex-col group-[.is-sized]/split:[&_.ant-tabs-content-active]:overflow-auto",
          // The open tab scrolls on its own: take in the padding so the table rows' drag grips (KvTable) aren't clipped.
          "group-[.is-sized]/split:[&_.ant-tabs-content-active]:-ml-4 group-[.is-sized]/split:[&_.ant-tabs-content-active]:pl-4",
        )}
        items={tabs}
      />
    </div>
    </VariableOptions.Provider>
    </HasVariable.Provider>
  );
}
