// GraphQL Requests: the Schema from an introspection response, and the edits the Schema explorer
// makes to the query (check a field or an argument, give an argument a value). The query keeps one
// operation; arguments are passed as `$variables` whose values live in the GraphQL variables JSON.
import {
  buildClientSchema,
  getIntrospectionQuery,
  getNamedType,
  isCompositeType,
  isInputObjectType,
  isInterfaceType,
  isLeafType,
  isListType,
  isNonNullType,
  isObjectType,
  Kind,
  parse,
  parseType,
  print,
  visit,
  type ArgumentNode,
  type DocumentNode,
  type FieldNode,
  type GraphQLArgument,
  type GraphQLField,
  type GraphQLInputType,
  type GraphQLSchema,
  type OperationDefinitionNode,
  type OperationTypeNode,
  type SelectionNode,
  type SelectionSetNode,
} from "graphql";

export const INTROSPECTION_QUERY = getIntrospectionQuery();

/** The Schema in an introspection response body, or an Error saying why there is none. */
export function schemaFromResponse(status: number, body: string): GraphQLSchema {
  let json: { data?: { __schema?: unknown }; errors?: { message?: string }[] };
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(status >= 400 ? `The server answered ${status}.` : "The response is not JSON.");
  }
  if (!json.data?.__schema) throw new Error(json.errors?.[0]?.message ?? `The server answered ${status} without a schema.`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return buildClientSchema(json.data as any);
}

export type OpKind = "query" | "mutation";

/** The query as a document: empty text is an empty document, a syntax error throws. */
export function parseQuery(text: string): DocumentNode {
  return text.trim() ? parse(text) : { kind: Kind.DOCUMENT, definitions: [] };
}

export const printQuery = (doc: DocumentNode) => (doc.definitions.length ? print(doc) + "\n" : "");

const operationOf = (doc: DocumentNode) =>
  doc.definitions.find((d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION);

/** The kind of the query's operation, if it has one with fields. */
export function operationKind(doc: DocumentNode): OpKind | null {
  const op = operationOf(doc);
  return op?.selectionSet.selections.length ? (op.operation as OpKind) : null;
}

const fieldsOf = (set: SelectionSetNode | undefined) =>
  (set?.selections ?? []).filter((s): s is FieldNode => s.kind === Kind.FIELD && !s.alias);

/** The field at `path` (field names from the root) in the operation of `kind`, if checked. */
export function fieldAt(doc: DocumentNode, kind: OpKind, path: string[]): FieldNode | undefined {
  const op = operationOf(doc);
  if (!op || op.operation !== kind) return undefined;
  let set: SelectionSetNode | undefined = op.selectionSet;
  let node: FieldNode | undefined;
  for (const name of path) {
    node = fieldsOf(set).find((f) => f.name.value === name);
    if (!node) return undefined;
    set = node.selectionSet;
  }
  return node;
}

/** The fields of a type's field list, or none for a leaf / union. */
export function fieldsOfType(t: unknown): GraphQLField<unknown, unknown>[] {
  const named = getNamedType(t as never);
  return isObjectType(named) || isInterfaceType(named) ? Object.values(named.getFields()) : [];
}

/** The field definitions along `path`, from the root type of `kind`. */
function defsAt(schema: GraphQLSchema, kind: OpKind, path: string[]) {
  let type: unknown = schema.getRootType(kind as OperationTypeNode);
  return path.map((name) => {
    const def = fieldsOfType(type).find((f) => f.name === name);
    if (!def) throw new Error(`No field ${path.join(".")}`);
    type = def.type;
    return def;
  });
}

const nameNode = (value: string) => ({ kind: Kind.NAME, value }) as const;
const setOf = (selections: readonly SelectionNode[]): SelectionSetNode => ({ kind: Kind.SELECTION_SET, selections });

/** Rebuild the selection set along `path`, `fn` changing the set the last field sits in. */
function editSet(
  set: SelectionSetNode,
  path: string[],
  fn: (set: SelectionSetNode) => SelectionSetNode,
  make: (depth: number) => FieldNode,
  depth = 0,
): SelectionSetNode {
  if (path.length === 1) return fn(set);
  const [head, ...rest] = path;
  const at = set.selections.findIndex((s) => s.kind === Kind.FIELD && !s.alias && s.name.value === head);
  const node = at < 0 ? make(depth) : (set.selections[at] as FieldNode);
  const next = { ...node, selectionSet: editSet(node.selectionSet ?? setOf([]), rest, fn, make, depth + 1) };
  const selections = [...set.selections];
  if (at < 0) selections.push(next);
  else selections[at] = next;
  return setOf(selections);
}

/** Drop fields whose selection set became empty, deepest first. */
function prune(set: SelectionSetNode): SelectionSetNode {
  return setOf(
    set.selections.flatMap((s) => {
      if (s.kind !== Kind.FIELD || !s.selectionSet) return [s];
      const inner = prune(s.selectionSet);
      return inner.selections.length ? [{ ...s, selectionSet: inner }] : [];
    }),
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Variables the operation still uses, and the definitions of those it no longer does removed. */
function dropUnusedVariables(op: OperationDefinitionNode): { op: OperationDefinitionNode; dropped: string[] } {
  const used = new Set<string>();
  visit(op.selectionSet, { Variable: (v) => void used.add(v.name.value) });
  const defs = op.variableDefinitions ?? [];
  const dropped = defs.filter((d) => !used.has(d.variable.name.value)).map((d) => d.variable.name.value);
  return { op: { ...op, variableDefinitions: defs.filter((d) => used.has(d.variable.name.value)) }, dropped };
}

/** What an explorer edit gives: the new query, and the variables to add (with a starting value) or remove. */
export type Edit = { query: string; add: Record<string, unknown>; remove: string[] };

/** A `$variable` name not taken in `op`: the argument's name, else prefixed with its field's. */
function freeVariable(op: OperationDefinitionNode, field: string, arg: string) {
  const taken = new Set((op.variableDefinitions ?? []).map((d) => d.variable.name.value));
  let name = taken.has(arg) ? field + capitalize(arg) : arg;
  for (let i = 2; taken.has(name); i++) name = field + capitalize(arg) + i;
  return name;
}

/** An argument passed as a new `$variable`: the argument node, its definition, its starting value. */
function argAsVariable(op: OperationDefinitionNode, field: string, arg: GraphQLArgument) {
  const variable = freeVariable(op, field, arg.name);
  const ref = { kind: Kind.VARIABLE, name: nameNode(variable) } as const;
  return {
    variable,
    node: { kind: Kind.ARGUMENT, name: nameNode(arg.name), value: ref } as ArgumentNode,
    def: { kind: Kind.VARIABLE_DEFINITION, variable: ref, type: parseType(String(arg.type)), directives: [] } as const,
  };
}

const requiredArgs = (def: GraphQLField<unknown, unknown>) => def.args.filter((a) => isNonNullType(a.type) && a.defaultValue === undefined);

/** The first field to select under a composite type when it is checked alone: `id`, else the first leaf. */
function defaultChild(def: GraphQLField<unknown, unknown>): string {
  const leaves = fieldsOfType(def.type).filter((f) => isLeafType(getNamedType(f.type)) && !requiredArgs(f).length);
  return (leaves.find((f) => f.name === "id") ?? leaves[0])?.name ?? "__typename";
}

/**
 * Check or uncheck the field at `path`. Checking adds the fields above it, its required arguments
 * as `$variables` and, for an object, a first sub-field; unchecking drops parents left empty.
 */
export function toggleField(doc: DocumentNode, schema: GraphQLSchema, kind: OpKind, path: string[], on: boolean): Edit {
  const defs = defsAt(schema, kind, path);
  const add: Record<string, unknown> = {};
  let op = operationOf(doc);
  if (!op || op.operation !== kind) {
    op = {
      kind: Kind.OPERATION_DEFINITION,
      operation: kind as OperationTypeNode,
      name: nameNode(capitalize(path[0])),
      variableDefinitions: [],
      directives: [],
      selectionSet: setOf([]),
    };
  }
  let current = op;
  // A new field, with its required arguments as variables (added to `current` as it goes).
  const make = (depth: number): FieldNode => {
    const def = defs[depth];
    const args = requiredArgs(def).map((a) => {
      const v = argAsVariable(current, def.name, a);
      current = { ...current, variableDefinitions: [...(current.variableDefinitions ?? []), v.def] };
      add[v.variable] = emptyValue(a.type);
      return v.node;
    });
    return { kind: Kind.FIELD, name: nameNode(def.name), arguments: args, directives: [] };
  };
  const leaf = path[path.length - 1];
  const def = defs[defs.length - 1];
  let set = editSet(
    current.selectionSet,
    path,
    (s) => {
      if (!on) return setOf(s.selections.filter((f) => !(f.kind === Kind.FIELD && !f.alias && f.name.value === leaf)));
      if (fieldsOf(s).some((f) => f.name.value === leaf)) return s;
      const node = make(path.length - 1);
      const child: FieldNode = { kind: Kind.FIELD, name: nameNode(defaultChild(def)), arguments: [], directives: [] };
      return setOf([...s.selections, isCompositeType(getNamedType(def.type)) ? { ...node, selectionSet: setOf([child]) } : node]);
    },
    make,
  );
  if (!on) set = prune(set);
  const { op: next, dropped } = dropUnusedVariables({ ...current, selectionSet: set });
  const others = doc.definitions.filter((d) => d !== operationOf(doc));
  const out: DocumentNode = { kind: Kind.DOCUMENT, definitions: next.selectionSet.selections.length ? [next, ...others] : others };
  return { query: printQuery(out), add, remove: dropped };
}

/** Check or uncheck an argument of the (checked or not) field at `path`; checking passes it as a `$variable`. */
export function toggleArg(doc: DocumentNode, schema: GraphQLSchema, kind: OpKind, path: string[], arg: string, on: boolean): Edit {
  // The field must be in the query first.
  let edit: Edit = { query: printQuery(doc), add: {}, remove: [] };
  if (on && !fieldAt(doc, kind, path)) {
    edit = toggleField(doc, schema, kind, path, true);
    doc = parse(edit.query);
    if (fieldAt(doc, kind, path)?.arguments?.some((a) => a.name.value === arg)) return edit;
  }
  const defs = defsAt(schema, kind, path);
  const def = defs[defs.length - 1];
  const a = def.args.find((x) => x.name === arg)!;
  let op = operationOf(doc)!;
  const leaf = path[path.length - 1];
  const withArgs = (fn: (args: readonly ArgumentNode[]) => readonly ArgumentNode[]) =>
    editSet(
      op.selectionSet,
      path,
      (s) => setOf(s.selections.map((f) => (f.kind === Kind.FIELD && !f.alias && f.name.value === leaf ? { ...f, arguments: fn(f.arguments ?? []) } : f))),
      () => {
        throw new Error("unreachable");
      },
    );
  const add = { ...edit.add };
  if (on) {
    const v = argAsVariable(op, def.name, a);
    op = { ...op, variableDefinitions: [...(op.variableDefinitions ?? []), v.def] };
    op = { ...op, selectionSet: withArgs((args) => [...args, v.node]) };
    add[v.variable] = emptyValue(a.type);
  } else {
    op = { ...op, selectionSet: withArgs((args) => args.filter((x) => x.name.value !== arg)) };
  }
  const { op: next, dropped } = dropUnusedVariables(op);
  const out: DocumentNode = { ...doc, definitions: doc.definitions.map((d) => (d === operationOf(doc) ? next : d)) };
  return { query: printQuery(out), add, remove: [...edit.remove, ...dropped] };
}

/** A variable's value before anything is typed: "" for text, null otherwise (the server says what is missing). */
function emptyValue(t: GraphQLInputType): unknown {
  const named = getNamedType(t);
  if (isListType(isNonNullType(t) ? t.ofType : t)) return [];
  if (isInputObjectType(named)) return {};
  return named.name === "String" || named.name === "ID" ? "" : null;
}

/** What an argument is given in the query: the `$variable` it reads, or the literal written in. */
export function argValue(field: FieldNode | undefined, arg: string): { variable: string } | { literal: string } | null {
  const node = field?.arguments?.find((a) => a.name.value === arg);
  if (!node) return null;
  return node.value.kind === Kind.VARIABLE ? { variable: node.value.name.value } : { literal: print(node.value) };
}

/** Text typed for an argument as the JSON value of its variable: numbers and booleans as such, lists and objects as JSON. */
export function inputValue(text: string, t: GraphQLInputType): unknown {
  const named = getNamedType(t).name;
  if ((named === "Int" || named === "Float") && text.trim() && !isNaN(Number(text))) return Number(text);
  if (named === "Boolean" && (text === "true" || text === "false")) return text === "true";
  if (named !== "String" && named !== "ID" && /^\s*[[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

/** A variable's JSON value as the text shown in its argument's box. */
export const valueText = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v));

/** The GraphQL variables JSON as an object, or null when it is not a JSON object. Empty text is `{}`. */
export function parseVariables(text: string): Record<string, unknown> | null {
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** The variables JSON with `add` set (kept when already there unless `force`) and `remove` dropped; "" when empty. */
export function editVariables(text: string, add: Record<string, unknown>, remove: string[], force = false): string | null {
  const vars = parseVariables(text);
  if (!vars) return null;
  const next = { ...vars };
  for (const k of remove) delete next[k];
  for (const [k, v] of Object.entries(add)) if (force || !(k in next)) next[k] = v;
  return Object.keys(next).length ? JSON.stringify(next, null, 2) : "";
}
