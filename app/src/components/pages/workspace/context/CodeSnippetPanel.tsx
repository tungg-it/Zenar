import { useMemo, useState } from "react";
import { Alert, App as AntApp, Checkbox, Popover, Select } from "antd";
import { LuCheck, LuCopy, LuSettings } from "react-icons/lu";
import type { RequestPreview } from "@/bindings/RequestPreview";
import { CodeView, IconButton, preWrap, treeEmpty } from "@/components/ui";
import { ctxHead, ctxPanel } from "./styles";
import { setSnippetPrefs, snippetPrefs } from "@/libs/prefs";
import {
  DEFAULT_SNIPPET_OPTIONS,
  SNIPPET_LANGUAGES,
  highlightSnippet,
  isSnippetLanguage,
  snippet,
  type SnippetLanguage,
  type SnippetOptions,
} from "@/libs/snippets";

const INDENTS = [
  { value: "  ", label: "2 spaces" },
  { value: "    ", label: "4 spaces" },
  { value: "\t", label: "Tab" },
];

function loadPrefs(): { language: SnippetLanguage; options: SnippetOptions } {
  const p = snippetPrefs();
  const o = (p.options ?? {}) as Partial<SnippetOptions>;
  return {
    language: typeof p.language === "string" && isSnippetLanguage(p.language) ? p.language : "curl",
    options: {
      indent: INDENTS.some((x) => x.value === o.indent) ? o.indent! : DEFAULT_SNIPPET_OPTIONS.indent,
      trimBody: typeof o.trimBody === "boolean" ? o.trimBody : DEFAULT_SNIPPET_OPTIONS.trimBody,
      followRedirects: typeof o.followRedirects === "boolean" ? o.followRedirects : DEFAULT_SNIPPET_OPTIONS.followRedirects,
    },
  };
}

/** The request Send would make (variables resolved) as code in the chosen language, like Postman's Code snippet. */
export function CodeSnippetPanel({ preview }: { preview: RequestPreview | null }) {
  const { message } = AntApp.useApp();
  const [prefs, setPrefs] = useState(loadPrefs);
  const update = (next: Partial<typeof prefs>) => {
    const p = { ...prefs, ...next };
    setPrefs(p);
    setSnippetPrefs(p);
  };
  const setOption = (o: Partial<SnippetOptions>) => update({ options: { ...prefs.options, ...o } });
  const code = useMemo(() => (preview?.request ? snippet(prefs.language, preview.request, prefs.options) : ""), [preview, prefs]);
  const lines = useMemo(() => highlightSnippet(code, prefs.language), [code, prefs.language]);
  const label = SNIPPET_LANGUAGES.find((l) => l.key === prefs.language)?.label ?? "";

  const settings = (
    <div className="flex min-w-[200px] flex-col gap-2">
      <label className="flex items-center justify-between gap-3">
        <span>Indent</span>
        <Select size="small" value={prefs.options.indent} options={INDENTS} onChange={(indent) => setOption({ indent })} popupMatchSelectWidth={false} />
      </label>
      <Checkbox checked={prefs.options.trimBody} onChange={(e) => setOption({ trimBody: e.target.checked })}>
        Trim request body
      </Checkbox>
      <Checkbox checked={prefs.options.followRedirects} onChange={(e) => setOption({ followRedirects: e.target.checked })}>
        Follow redirects
      </Checkbox>
    </div>
  );

  return (
    <div className={ctxPanel}>
      <div className={ctxHead}>
        <span className="font-semibold">Code snippet</span>
      </div>
      <div className="mb-1 flex items-center justify-between text-z-muted">
        <Select
          size="small"
          variant="borderless"
          className="-ml-[7px] font-medium"
          value={prefs.language}
          onChange={(language) => update({ language })}
          options={SNIPPET_LANGUAGES.map((l) => ({ value: l.key, label: l.label }))}
          popupMatchSelectWidth={false}
          // Postman marks the chosen language with a check.
          optionRender={(o) => (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex w-3.5">{o.value === prefs.language && <LuCheck />}</span>
              {o.label}
            </span>
          )}
          showSearch={{ optionFilterProp: "label" }}
          aria-label="Snippet language"
        />
        <span className="inline-flex gap-0.5">
          <Popover trigger="click" placement="bottomRight" title="Snippet settings" content={settings}>
            <span>
              <IconButton label="Settings" icon={<LuSettings />} />
            </span>
          </Popover>
          <IconButton
            label="Copy snippet"
            icon={<LuCopy />}
            disabled={!code}
            onClick={() => navigator.clipboard?.writeText(code).then(() => message.success(`${label} copied`), () => {})}
          />
        </span>
      </div>
      {preview?.error && <Alert type="warning" showIcon className="mb-2" title={<span className={preWrap}>{preview.error}</span>} />}
      {!preview && <p className={treeEmpty}>Loading…</p>}
      {code && <CodeView lines={lines} wrap label={`${label} snippet`} variant="inline" />}
    </div>
  );
}
