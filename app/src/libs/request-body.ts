// Typed access to the parts of a Request body kept in `body_extra` (mirrors the Rust
// `RequestItem::form_fields` / `body_file` / `graphql_variables`): `formdata` keeps its fields under
// `fields`, `binary` the file path under `file`, `graphql` the variables (JSON text) under `variables`.
import type { FormField } from "@/bindings/FormField";
import type { RequestItem } from "@/bindings/RequestItem";

const extra = (r: RequestItem): Record<string, unknown> => r.body_extra ?? {};

const withExtra = (r: RequestItem, key: string, value: unknown): RequestItem => ({ ...r, body_extra: { ...extra(r), [key]: value } });

export const formFields = (r: RequestItem): FormField[] => (Array.isArray(extra(r).fields) ? (extra(r).fields as FormField[]) : []);
export const withFormFields = (r: RequestItem, fields: FormField[]) => withExtra(r, "fields", fields);

export const bodyFile = (r: RequestItem): string => (typeof extra(r).file === "string" ? (extra(r).file as string) : "");
export const withBodyFile = (r: RequestItem, path: string) => withExtra(r, "file", path);

export const graphqlVariables = (r: RequestItem): string => (typeof extra(r).variables === "string" ? (extra(r).variables as string) : "");
export const withGraphqlVariables = (r: RequestItem, v: string) => withExtra(r, "variables", v);

/** File name of a path, for display. */
export const fileName = (path: string) => path.split(/[\\/]/).pop() || path;
