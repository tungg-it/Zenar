import { parseCurl, type CurlRequest } from "@/libs/curl";
import { urlTokens } from "@/libs/url-params";
import { useHasVariable } from "./has-variable";
import { VarInput } from "./VarInput";

/**
 * The URL bar, coloured like Postman's: `{{variable}}` and `:path` segments show blue when they
 * have a value, red when they don't (see `VarInput`).
 */
export function UrlInput({
  value,
  onChange,
  onBlur,
  onPressEnter,
  onPasteCurl,
  hasPathValue,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  onPressEnter: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Pasted text is a cURL command: fill the Request from it instead of pasting it as the URL. */
  onPasteCurl: (curl: CurlRequest) => void;
  /** Whether the Path Variable `name` has a value. */
  hasPathValue: (name: string) => boolean;
}) {
  const hasVariable = useHasVariable();
  const tokens = urlTokens(value).map((t) =>
    t.kind ? { text: t.text, known: t.kind === "variable" ? hasVariable(t.name) : hasPathValue(t.name) } : { text: t.text },
  );

  return (
    <VarInput
      mono
      tokens={tokens}
      placeholder="Enter URL or paste text"
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      onPressEnter={onPressEnter}
      onPaste={(e) => {
        const curl = parseCurl(e.clipboardData.getData("text"));
        if (!curl) return;
        e.preventDefault();
        onPasteCurl(curl);
      }}
      id="request-url"
      aria-label="URL"
    />
  );
}
