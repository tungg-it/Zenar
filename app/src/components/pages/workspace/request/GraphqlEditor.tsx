import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { App as AntApp, Button, Checkbox, Input, Spin } from "antd";
import { LuChevronDown, LuChevronRight, LuCircleAlert, LuPanelLeftClose, LuPanelLeftOpen, LuRefreshCw, LuSearch, LuWandSparkles } from "react-icons/lu";
import { printSchema, validate, type DocumentNode, type GraphQLError, type GraphQLField, type GraphQLSchema } from "graphql";
import type { HttpResponse } from "@/bindings/HttpResponse";
import type { RequestItem } from "@/bindings/RequestItem";
import { CodeView, IconButton, isGraphql } from "@/components/ui";
import { highlight } from "@/libs/body-format";
import { cx } from "@/libs/cx";
import {
  argValue,
  editVariables,
  fieldAt,
  fieldsOfType,
  INTROSPECTION_QUERY,
  inputValue,
  operationKind,
  parseQuery,
  parseVariables,
  printQuery,
  schemaFromResponse,
  toggleArg,
  toggleField,
  valueText,
  type Edit,
  type OpKind,
} from "@/libs/graphql-query";
import { graphqlVariables, withGraphqlVariables } from "@/libs/request-body";
import { CodeEditor } from "./CodeEditor";

/**
 * A GraphQL Request (made from New → GraphQL), marked `kind: graphql` in its file. Its body is the
 * query (`body_type: graphql`), sent as POST with the variables JSON. An HTTP Request can send a
 * GraphQL body too (Body → GraphQL) and keeps the HTTP editor.
 */
export { isGraphql };

export type SchemaInfo = { schema?: GraphQLSchema; loading: boolean; error?: string; at?: number };

// Schemas by endpoint URL, for this run of the app: tabs on the same endpoint share one.
const schemas = new Map<string, SchemaInfo>();

/**
 * The Schema of a GraphQL Request's endpoint, from an introspection query sent with the Request's
 * Authorization and Headers. Fetched once per URL, a moment after it stops changing; `refresh` asks again.
 */
export function useGraphqlSchema(item: RequestItem, introspect: ((r: RequestItem) => Promise<HttpResponse>) | undefined) {
  const key = isGraphql(item) ? item.url.trim() : "";
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const latest = useRef({ item, introspect });
  latest.current = { item, introspect };

  const refresh = useCallback(async () => {
    const { item: r, introspect: run } = latest.current;
    if (!key || !run) return;
    schemas.set(key, { ...schemas.get(key), loading: true });
    rerender();
    try {
      const res = await run({ ...r, method: "POST", body: INTROSPECTION_QUERY, body_extra: null, captures: [], scripts: { pre_request: "", post_response: "" } });
      schemas.set(key, { schema: schemaFromResponse(res.status, res.body), loading: false, at: Date.now() });
    } catch (e) {
      schemas.set(key, { ...schemas.get(key), loading: false, error: e instanceof Error ? e.message : String(e), at: Date.now() });
    }
    rerender();
  }, [key]);

  useEffect(() => {
    if (!key || schemas.has(key)) return;
    const t = setTimeout(refresh, 600);
    return () => clearTimeout(t);
  }, [key, refresh]);

  return { ...(schemas.get(key) ?? { loading: false }), refresh, hasUrl: !!key };
}

export type GraphqlSchema = ReturnType<typeof useGraphqlSchema>;

type VarsEdit = Omit<Edit, "query"> & { query?: string };

const ROOTS: { kind: OpKind; label: string }[] = [
  { kind: "query", label: "Query" },
  { kind: "mutation", label: "Mutation" },
];

/**
 * Query tab of a GraphQL Request, like Postman's: the Schema explorer on the left (check fields
 * and arguments to write the query), the query on the right, its variables folded under it.
 */
export function GraphqlQuery({ item, onChange, schema }: { item: RequestItem; onChange: (r: RequestItem) => void; schema: GraphqlSchema }) {
  const { message } = AntApp.useApp();
  const [explorerOpen, setExplorerOpen] = useState(true);
  const variables = graphqlVariables(item);
  const [varsOpen, setVarsOpen] = useState(() => !!variables.trim());
  const body = item.body ?? "";

  const parsed = useMemo((): { doc: DocumentNode; error?: undefined } | { doc?: undefined; error: GraphQLError } => {
    try {
      return { doc: parseQuery(body) };
    } catch (e) {
      return { error: e as GraphQLError };
    }
  }, [body]);
  const problem = useMemo(() => {
    if (parsed.error) return parsed.error;
    return schema.schema && parsed.doc.definitions.length ? validate(schema.schema, parsed.doc)[0] : undefined;
  }, [parsed, schema.schema]);

  // An edit without `query` only sets variables (an argument's value): the query keeps its formatting.
  function apply(edit: VarsEdit, force = false) {
    const vars = editVariables(variables, edit.add, edit.remove, force);
    if (vars === null) message.warning("The GraphQL variables are not a JSON object, so they were left as they are.");
    else if (vars.trim() && !variables.trim()) setVarsOpen(true);
    onChange(withGraphqlVariables({ ...item, body: edit.query ?? body }, vars ?? variables));
  }

  function prettify() {
    if (parsed.doc) onChange({ ...item, body: printQuery(parsed.doc) });
    else message.warning("The query has a syntax error, so it cannot be prettified.");
  }

  return (
    <div className="flex h-[440px] min-h-0 gap-3 group-[.is-sized]/split:h-auto group-[.is-sized]/split:flex-1">
      {explorerOpen ? (
        <Explorer
          schema={schema}
          doc={parsed.doc}
          variables={variables}
          onEdit={apply}
          onCollapse={() => setExplorerOpen(false)}
        />
      ) : (
        <div className="flex flex-none flex-col border-r border-z-border pr-1.5">
          <IconButton label="Show schema explorer" icon={<LuPanelLeftOpen />} onClick={() => setExplorerOpen(true)} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="relative flex min-h-0 flex-1 flex-col">
          <CodeEditor fill variables value={body} onChange={(v) => onChange({ ...item, body: v })} language="graphql" label="GraphQL query" />
          <div className="absolute top-1.5 right-1.5 z-20">
            <IconButton label="Prettify query" icon={<LuWandSparkles />} onClick={prettify} />
          </div>
        </div>
        {problem && (
          <p role="status" className="m-0 flex items-start gap-1.5 text-sm text-z-delete">
            <LuCircleAlert className="mt-0.5 flex-none" aria-hidden />
            <span className="min-w-0 break-words">
              {problem.locations?.[0] && <span className="font-mono">Ln {problem.locations[0].line}: </span>}
              {problem.message}
            </span>
          </p>
        )}
        <div className={cx("flex min-h-0 flex-col rounded border border-z-border", varsOpen && "h-[38%] flex-none")}>
          <button
            type="button"
            aria-expanded={varsOpen}
            className="flex h-8 flex-none cursor-pointer items-center gap-1.5 border-0 bg-transparent px-2.5 text-left text-sm font-semibold text-z-muted hover:text-z-text focus-visible:outline-2 focus-visible:outline-z-link"
            onClick={() => setVarsOpen(!varsOpen)}
          >
            {varsOpen ? <LuChevronDown aria-hidden /> : <LuChevronRight aria-hidden />}
            Variables
            {!varsOpen && variables.trim() && <span className="ml-1 inline-block size-1.5 rounded-full bg-z-get" aria-label="has variables" />}
          </button>
          {varsOpen && (
            <div className="flex min-h-0 flex-1 flex-col px-1.5 pb-1.5">
              <CodeEditor fill variables value={variables} onChange={(v) => onChange(withGraphqlVariables(item, v))} language="json" label="GraphQL variables" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Left pane of the Query tab: the Schema's root fields as a tree of checkboxes that write the query. */
function Explorer({
  schema: info,
  doc,
  variables,
  onEdit,
  onCollapse,
}: {
  schema: GraphqlSchema;
  /** Undefined while the query has a syntax error: nothing can be checked. */
  doc: DocumentNode | undefined;
  variables: string;
  onEdit: (edit: VarsEdit, force?: boolean) => void;
  onCollapse: () => void;
}) {
  const [search, setSearch] = useState("");
  // Expanded rows, by "kind:path.to.field".
  const [open, setOpen] = useState<Set<string>>(() => new Set(["query", "mutation"]));
  const { schema } = info;
  const inQuery = doc ? operationKind(doc) : null;
  const vars = parseVariables(variables) ?? {};
  const q = search.trim().toLowerCase();

  const toggleOpen = (key: string, to = !open.has(key)) =>
    setOpen((s) => {
      const n = new Set(s);
      if (to) n.add(key);
      else n.delete(key);
      return n;
    });

  function row(kind: OpKind, def: GraphQLField<unknown, unknown>, path: string[], disabled: boolean): React.ReactNode {
    const key = `${kind}:${path.join(".")}`;
    const node = doc && fieldAt(doc, kind, path);
    const children = fieldsOfType(def.type);
    const expandable = children.length > 0 || def.args.length > 0;
    const expanded = open.has(key);
    const depth = path.length - 1;
    return (
      <div key={key} role="treeitem" aria-expanded={expandable ? expanded : undefined} aria-selected={!!node}>
        <div className="flex h-7 items-center gap-1.5 rounded pr-2 hover:bg-z-hover" style={{ paddingLeft: depth * 18 }}>
          {expandable ? (
            <button
              type="button"
              aria-label={`${expanded ? "Collapse" : "Expand"} ${def.name}`}
              className="flex size-5 flex-none cursor-pointer items-center justify-center rounded border-0 bg-transparent text-z-muted hover:text-z-text focus-visible:outline-2 focus-visible:outline-z-link"
              onClick={() => toggleOpen(key)}
            >
              {expanded ? <LuChevronDown /> : <LuChevronRight />}
            </button>
          ) : (
            <span className="w-5 flex-none" />
          )}
          <Checkbox
            checked={!!node}
            disabled={disabled}
            aria-label={def.name}
            onChange={(e) => {
              if (!doc || !schema) return;
              onEdit(toggleField(doc, schema, kind, path, e.target.checked));
              if (e.target.checked && children.length) toggleOpen(key, true);
            }}
          />
          <span className="min-w-0 truncate font-mono text-code text-z-text" title={def.description ?? undefined}>
            {def.name}
          </span>
          <span className="truncate font-mono text-code text-z-faint">{String(def.type)}</span>
        </div>
        {expanded && (
          <div role="group">
            {def.args.map((a) => {
              const given = argValue(node, a.name);
              return (
                <div key={a.name} className="flex h-7 items-center gap-1.5 rounded pr-2 hover:bg-z-hover" style={{ paddingLeft: (depth + 1) * 18 }}>
                  <span className="w-5 flex-none" />
                  <Checkbox
                    checked={!!given}
                    disabled={disabled}
                    aria-label={`Argument ${a.name}`}
                    onChange={(e) => doc && schema && onEdit(toggleArg(doc, schema, kind, path, a.name, e.target.checked))}
                  />
                  <span className="truncate font-mono text-code text-z-text" title={a.description ?? undefined}>
                    {a.name}
                  </span>
                  <span className="truncate font-mono text-code text-z-faint">{String(a.type)}</span>
                  {given && (
                    <Input
                      size="small"
                      className="ml-1 w-44 flex-none font-mono text-code"
                      placeholder="Enter value"
                      aria-label={`Value of ${a.name}`}
                      disabled={"literal" in given}
                      title={"literal" in given ? "Written in the query" : `Sets $${given.variable} in the variables`}
                      value={"literal" in given ? given.literal : valueText(vars[given.variable])}
                      onChange={(e) =>
                        "variable" in given &&
                        onEdit({ add: { [given.variable]: inputValue(e.target.value, a.type) }, remove: [] }, true)
                      }
                    />
                  )}
                  <span className="flex-none text-2xs font-semibold tracking-wide text-z-code-number">ARG</span>
                </div>
              );
            })}
            {children.map((c) => row(kind, c, [...path, c.name], disabled))}
          </div>
        )}
      </div>
    );
  }

  let content: React.ReactNode;
  if (!info.hasUrl) content = <p className="m-0 px-2 py-3 text-z-muted">Enter the GraphQL endpoint URL to load its schema.</p>;
  else if (!schema && info.loading)
    content = (
      <div className="flex items-center gap-2 px-2 py-3 text-z-muted">
        <Spin size="small" /> Loading the schema…
      </div>
    );
  else if (!schema)
    content = (
      <div className="flex flex-col items-start gap-2 px-2 py-3">
        <p className="m-0 text-z-muted">The schema could not be loaded{info.error ? `: ${info.error}` : "."}</p>
        <Button size="small" icon={<LuRefreshCw />} onClick={info.refresh}>
          Try again
        </Button>
      </div>
    );
  else
    content = (
      <div role="tree" aria-label="Schema">
        {!doc && <p className="m-0 mb-1 px-2 py-1.5 text-sm text-z-delete">Fix the syntax error in the query to use the explorer.</p>}
        {ROOTS.map(({ kind, label }) => {
          const root = schema.getRootType(kind as never);
          if (!root) return null;
          const fields = fieldsOfType(root).filter((f) => !q || f.name.toLowerCase().includes(q));
          // One operation per Request: the other kind waits until the query is emptied.
          const disabled = !doc || (!!inQuery && inQuery !== kind);
          const expanded = !!q || open.has(kind);
          return (
            <div key={kind} role="treeitem" aria-expanded={expanded} aria-selected={false}>
              <button
                type="button"
                className="flex h-7 w-full cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent px-0 text-left text-sm font-semibold text-z-muted hover:text-z-text focus-visible:outline-2 focus-visible:outline-z-link"
                onClick={() => toggleOpen(kind)}
              >
                <span className="flex size-5 items-center justify-center">{expanded ? <LuChevronDown /> : <LuChevronRight />}</span>
                {label}
                {!!inQuery && inQuery !== kind && <span className="font-normal text-z-faint">· the query is a {inQuery}</span>}
              </button>
              {expanded && (
                <div role="group">
                  {fields.length ? fields.map((f) => row(kind, f, [f.name], disabled)) : <p className="m-0 py-1 pl-7 text-z-faint">No matching fields</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );

  return (
    <aside className="flex w-[44%] max-w-[560px] min-w-[260px] flex-none flex-col gap-2 border-r border-z-border pr-3" aria-label="Schema explorer">
      <div className="flex flex-none items-center gap-1">
        <Input
          size="small"
          prefix={<LuSearch className="text-z-faint" />}
          placeholder="Search fields"
          aria-label="Search fields"
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={!schema}
        />
        <IconButton label="Refresh schema" icon={<LuRefreshCw className={cx(info.loading && "animate-spin motion-reduce:animate-none")} />} onClick={info.refresh} disabled={!info.hasUrl || info.loading} />
        <IconButton label="Hide schema explorer" icon={<LuPanelLeftClose />} onClick={onCollapse} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{content}</div>
    </aside>
  );
}

/** Schema tab of a GraphQL Request: where the schema comes from, its state, and the schema as SDL. */
export function GraphqlSchemaTab({ schema: info }: { schema: GraphqlSchema }) {
  const sdl = useMemo(() => (info.schema ? printSchema(info.schema) : ""), [info.schema]);
  const lines = useMemo(() => highlight(sdl, "graphql"), [sdl]);
  const types = info.schema ? Object.keys(info.schema.getTypeMap()).filter((t) => !t.startsWith("__")).length : 0;
  return (
    <div className="flex min-h-0 flex-col gap-3 pb-3 group-[.is-sized]/split:flex-1">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Using schema introspection</div>
          <div className="text-sm text-z-muted">
            The schema is asked from the endpoint with this Request's Authorization and Headers. It stays on this machine until the app closes.
          </div>
        </div>
        <Button icon={<LuRefreshCw className={cx(info.loading && "animate-spin motion-reduce:animate-none")} />} onClick={info.refresh} disabled={!info.hasUrl || info.loading}>
          Refresh schema
        </Button>
      </div>
      <p role="status" className={cx("m-0 text-sm", info.error && !info.loading ? "text-z-delete" : "text-z-muted")}>
        {!info.hasUrl
          ? "Enter the endpoint URL first."
          : info.loading
            ? "Loading the schema…"
            : info.error
              ? `Could not load the schema: ${info.error}`
              : info.schema
                ? `${types} types, loaded at ${new Date(info.at ?? Date.now()).toLocaleTimeString()}.`
                : "Not loaded yet."}
      </p>
      {info.schema && (
        <div className="h-[360px] min-h-0 overflow-hidden rounded border border-z-border group-[.is-sized]/split:h-auto group-[.is-sized]/split:flex-1">
          <CodeView lines={lines} wrap={false} label="Schema" />
        </div>
      )}
    </div>
  );
}
