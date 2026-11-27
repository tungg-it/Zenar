// Small HTTP helpers for showing responses.

const REASONS: Record<number, string> = {
  100: "Continue", 101: "Switching Protocols", 200: "OK", 201: "Created", 202: "Accepted", 204: "No Content",
  206: "Partial Content", 301: "Moved Permanently", 302: "Found", 303: "See Other", 304: "Not Modified",
  307: "Temporary Redirect", 308: "Permanent Redirect", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
  404: "Not Found", 405: "Method Not Allowed", 406: "Not Acceptable", 408: "Request Timeout", 409: "Conflict",
  410: "Gone", 413: "Payload Too Large", 415: "Unsupported Media Type", 422: "Unprocessable Entity",
  429: "Too Many Requests", 500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway",
  503: "Service Unavailable", 504: "Gateway Timeout",
};

/** "200 OK", "418" when the reason phrase is unknown. */
export const statusText = (status: number) => (REASONS[status] ? `${status} ${REASONS[status]}` : String(status));

export type StatusClass = "success" | "redirect" | "client-error" | "server-error" | "info";
export const statusClass = (s: number): StatusClass =>
  s >= 500 ? "server-error" : s >= 400 ? "client-error" : s >= 300 ? "redirect" : s >= 200 ? "success" : "info";

export type Cookie = { name: string; value: string; domain?: string; path?: string; expires?: string; httpOnly: boolean; secure: boolean };

/** Parse one `Set-Cookie` header value. */
export function parseSetCookie(header: string): Cookie {
  const [pair, ...attrs] = header.split(";").map((p) => p.trim());
  const eq = pair.indexOf("=");
  const c: Cookie = { name: eq < 0 ? pair : pair.slice(0, eq), value: eq < 0 ? "" : pair.slice(eq + 1), httpOnly: false, secure: false };
  for (const a of attrs) {
    const [k, ...v] = a.split("=");
    const key = k.trim().toLowerCase();
    const val = v.join("=").trim();
    if (key === "domain") c.domain = val;
    else if (key === "path") c.path = val;
    else if (key === "expires") c.expires = val;
    else if (key === "max-age" && !c.expires) c.expires = `in ${val}s`;
    else if (key === "httponly") c.httpOnly = true;
    else if (key === "secure") c.secure = true;
  }
  return c;
}
