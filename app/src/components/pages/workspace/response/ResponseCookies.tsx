import { Empty } from "antd";
import type { Header } from "@/bindings/Header";
import { parseSetCookie } from "@/libs/http";
import { KvRow, KvTable } from "@/components/ui";

/** Cookies tab: the `Set-Cookie` headers of the response, one row per cookie. */
export function ResponseCookies({ headers }: { headers: Header[] }) {
  const cookies = headers.filter((h) => h.key.toLowerCase() === "set-cookie").map((h) => parseSetCookie(h.value));
  if (cookies.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No cookies received from the server" />;
  return (
    <KvTable role="table">
      <KvRow columns="cookie" head role="row">
        <span>Name</span>
        <span>Value</span>
        <span>Domain</span>
        <span>Path</span>
        <span>Expires</span>
        <span>HttpOnly</span>
        <span>Secure</span>
      </KvRow>
      {cookies.map((c, i) => (
        <KvRow columns="cookie" role="row" key={i}>
          <span className="font-medium">{c.name}</span>
          <span className="font-mono text-code">{c.value}</span>
          <span>{c.domain ?? ""}</span>
          <span>{c.path ?? ""}</span>
          <span>{c.expires ?? "Session"}</span>
          <span>{c.httpOnly ? "true" : "false"}</span>
          <span>{c.secure ? "true" : "false"}</span>
        </KvRow>
      ))}
    </KvTable>
  );
}
