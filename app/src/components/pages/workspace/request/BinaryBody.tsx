import { Button } from "antd";
import { LuFile, LuUpload, LuX } from "react-icons/lu";
import type { RequestItem } from "@/bindings/RequestItem";
import { bodyFile, fileName, withBodyFile } from "@/libs/request-body";
import { pickFile } from "@/service/files";

/** binary body: the bytes of one file, sent as is. */
export function BinaryBody({ item, onChange }: { item: RequestItem; onChange: (r: RequestItem) => void }) {
  const path = bodyFile(item);
  async function choose() {
    const p = await pickFile("Choose the file to send as the body");
    if (p) onChange(withBodyFile(item, p));
  }
  return (
    <div className="flex flex-col items-start gap-2.5 py-1">
      {path ? (
        <div className="flex max-w-full items-center gap-2 rounded border border-z-border py-1.5 pr-1.5 pl-2.5">
          <LuFile />
          <span className="font-medium whitespace-nowrap">{fileName(path)}</span>
          <span className="min-w-0 truncate font-mono text-sm text-z-faint select-text">{path}</span>
          <Button type="text" size="small" aria-label="Remove file" icon={<LuX />} onClick={() => onChange(withBodyFile(item, ""))} />
        </div>
      ) : (
        <p className="text-z-muted">Send the content of one file as the body, as is (Content-Type application/octet-stream unless you set one).</p>
      )}
      <Button icon={<LuUpload />} onClick={choose}>
        {path ? "Choose another file" : "Select file"}
      </Button>
      {path && <p className="mt-1.5 mb-0 text-sm text-z-muted">The path is on this machine. Members who run this Request pick their own file.</p>}
    </div>
  );
}
