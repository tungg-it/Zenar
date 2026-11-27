import { useMemo, useState } from "react";
import { App as AntApp, Button, Dropdown, Input, Tooltip } from "antd";
import { LuBinary, LuBraces, LuCheck, LuChevronDown, LuCode, LuCopy, LuEye, LuFileCode, LuFileText, LuHash, LuHeading, LuListTree, LuSearch, LuSquareCode, LuWrapText, LuX } from "react-icons/lu";
import { CodeView } from "@/components/ui";
import { detectFormat, GUIDED_FORMATS, renderBody, xmlToJson, yamlToJson, type BodyFormat } from "@/libs/body-format";
import { JsonPreview } from "./JsonPreview";
import { MarkdownPreview } from "./MarkdownPreview";
import { TreePreview } from "./TreePreview";
import { cx } from "@/libs/cx";

/** Text button of the body toolbar; `active` = the view or option that is on. */
const tool = (active = false) =>
  cx("inline-flex items-center gap-[5px]", active ? "bg-z-active text-z-text" : "text-z-muted hover:bg-z-active hover:text-z-text");

const FORMATS: { key: BodyFormat; label: string; icon: JSX.Element }[] = [
  { key: "json", label: "JSON", icon: <LuBraces /> },
  { key: "xml", label: "XML", icon: <LuCode /> },
  { key: "html", label: "HTML", icon: <LuFileCode /> },
  { key: "yaml", label: "YAML", icon: <LuListTree /> },
  { key: "javascript", label: "JavaScript", icon: <LuSquareCode /> },
  { key: "markdown", label: "Markdown", icon: <LuHeading /> },
  { key: "text", label: "Raw", icon: <LuFileText /> },
  { key: "hex", label: "Hex", icon: <LuBinary /> },
  { key: "base64", label: "Base64", icon: <LuHash /> },
];

/** Body tab: view picker (JSON / XML / HTML / Raw / Hex / Base64), Preview, wrap, search and copy. */
export function ResponseBody({ body, contentType }: { body: string; contentType: string | undefined }) {
  const { message } = AntApp.useApp();
  const detected = useMemo(() => detectFormat(contentType, body), [contentType, body]);
  const [chosen, setChosen] = useState<BodyFormat | null>(null);
  const format = chosen ?? detected;
  const [preview, setPreview] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [searching, setSearching] = useState(false);
  const [search, setSearch] = useState("");

  const { lines, note } = useMemo(() => renderBody(body, format), [body, format]);
  const hits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return 0;
    let n = 0;
    const text = body.toLowerCase();
    for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) n++;
    return n;
  }, [body, search]);
  const current = FORMATS.find((f) => f.key === format)!;
  // Parsed body for the table preview; undefined when the body is not JSON.
  const json = useMemo(() => {
    if (!preview || (format !== "json" && detected !== "json")) return undefined;
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return undefined;
    }
  }, [preview, format, detected, body]);
  // XML and YAML preview as the same collapsed tables; a body that does not parse falls back to the frame.
  const tree = useMemo<{ root?: string; value: unknown } | undefined>(() => {
    if (!preview || json !== undefined) return undefined;
    if (format === "xml") return xmlToJson(body);
    if (format === "yaml") return yamlToJson(body);
    return undefined;
  }, [preview, json, format, body]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Dropdown
            trigger={["click"]}
            menu={{
              selectedKeys: [format],
              items: FORMATS.flatMap((f, i) => [
                ...(f.key === "text" && i > 0 ? [{ type: "divider" as const }] : []),
                {
                  key: f.key,
                  icon: f.icon,
                  label: (
                    <span className="inline-flex items-center gap-2">
                      {f.label} {format === f.key && <LuCheck />}
                    </span>
                  ),
                  onClick: () => {
                    setChosen(f.key);
                    setPreview(false);
                  },
                },
              ]),
            }}
          >
            <Button size="small" type="text" className={tool(!preview)} onClick={() => setPreview(false)}>
              {current.icon} {current.label} <LuChevronDown />
            </Button>
          </Dropdown>
          <Button size="small" type="text" className={tool(preview)} icon={<LuEye />} onClick={() => setPreview(!preview)}>
            Preview
          </Button>
        </div>
        <div className="flex items-center gap-1">
          {searching && (
            <Input
              size="small"
              autoFocus
              className="w-[220px]"
              placeholder="Find in response"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && (setSearching(false), setSearch(""))}
              suffix={<span className="text-xs text-z-faint">{search.trim() ? `${hits} match${hits === 1 ? "" : "es"}` : ""}</span>}
            />
          )}
          <Tooltip title={wrap ? "Turn off line wrap" : "Wrap long lines"}>
            <Button size="small" type="text" className={tool(wrap)} aria-label="Wrap lines" icon={<LuWrapText />} onClick={() => setWrap(!wrap)} />
          </Tooltip>
          <Tooltip title={searching ? "Close search" : "Search"}>
            <Button
              size="small"
              type="text"
              className={tool(searching)}
              aria-label="Search in response"
              icon={searching ? <LuX /> : <LuSearch />}
              onClick={() => {
                setSearching(!searching);
                setSearch("");
              }}
            />
          </Tooltip>
          <Tooltip title="Copy response body">
            <Button
              size="small"
              type="text"
              className={tool()}
              aria-label="Copy response body"
              icon={<LuCopy />}
              onClick={() => navigator.clipboard?.writeText(body).then(() => message.success("Response copied"), () => {})}
            />
          </Tooltip>
        </div>
      </div>
      {note && !preview && <p className="mt-0 mb-1.5 text-sm text-z-post">{note}</p>}
      {preview && json !== undefined ? (
        <JsonPreview data={json} />
      ) : tree ? (
        <TreePreview root={tree.root} value={tree.value} />
      ) : preview && format === "markdown" ? (
        <MarkdownPreview source={body} />
      ) : preview ? (
        // Scripts never run: the preview is a fully sandboxed document.
        // A page preview always looks like a browser page, whatever the app theme.
        <iframe className="min-h-[200px] w-full flex-1 rounded border border-z-border bg-[color:Canvas] [color-scheme:light]" title="Response preview" sandbox="" srcDoc={previewDoc(body, format)} />
      ) : (
        <CodeView lines={lines} wrap={wrap} search={searching ? search.trim() : ""} guides={GUIDED_FORMATS.has(format)} />
      )}
    </div>
  );
}

/** The document the Preview frame shows: the page itself, anything else as text. */
function previewDoc(body: string, format: BodyFormat): string {
  return format === "html" || format === "xml" ? body : `<pre>${escapeHtml(body)}</pre>`;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
