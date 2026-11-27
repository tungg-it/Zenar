// Code snippets for a composed request (the right sidebar's Code snippet view), in the shape
// Postman generates them. Pure functions: HttpRequest + options in, source text out.
import type { HttpRequest } from "@/bindings/HttpRequest";
import type { Line, Token, TokenKind } from "@/libs/body-format";

export type SnippetLanguage =
  | "csharp"
  | "curl"
  | "dart"
  | "go"
  | "http"
  | "java"
  | "fetch"
  | "axios"
  | "php"
  | "powershell"
  | "python"
  | "ruby"
  | "rust"
  | "swift";

export type SnippetOptions = {
  /** One indentation step: "  ", "    " or "\t". */
  indent: string;
  trimBody: boolean;
  followRedirects: boolean;
};

export const DEFAULT_SNIPPET_OPTIONS: SnippetOptions = { indent: "  ", trimBody: false, followRedirects: true };

/** In Postman's menu order (alphabetical by label). */
export const SNIPPET_LANGUAGES: { key: SnippetLanguage; label: string }[] = [
  { key: "csharp", label: "C# - HttpClient" },
  { key: "curl", label: "cURL" },
  { key: "dart", label: "Dart - http" },
  { key: "go", label: "Go - Native" },
  { key: "http", label: "HTTP" },
  { key: "java", label: "Java - OkHttp" },
  { key: "fetch", label: "JavaScript - Fetch" },
  { key: "axios", label: "NodeJs - Axios" },
  { key: "php", label: "PHP - cURL" },
  { key: "powershell", label: "PowerShell - RestMethod" },
  { key: "python", label: "Python - Requests" },
  { key: "ruby", label: "Ruby - Net::HTTP" },
  { key: "rust", label: "Rust - reqwest" },
  { key: "swift", label: "Swift - URLSession" },
];

export const isSnippetLanguage = (v: string): v is SnippetLanguage => SNIPPET_LANGUAGES.some((l) => l.key === v);

// ---------- helpers ----------

/** Double-quoted string with JSON escapes: valid in JS, Java, C#, Go, Python, Swift, Rust. */
const dq = (s: string) => JSON.stringify(s);
/** Single-quoted for a POSIX shell: `'` becomes `'\''`. */
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** Single-quoted for PHP / Dart / JS: escape `\` and `'`. */
const sq = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const fileName = (p: string) => p.split(/[\\/]/).pop() || p;
const contentType = (r: HttpRequest) => r.headers.find((h) => h.key.toLowerCase() === "content-type")?.value;

type Body = { kind: "none" } | { kind: "raw"; text: string } | { kind: "form"; parts: NonNullable<HttpRequest["multipart"]> } | { kind: "file"; path: string };

function bodyOf(r: HttpRequest, o: SnippetOptions): Body {
  if (r.multipart) return { kind: "form", parts: r.multipart };
  if (r.body_file) return { kind: "file", path: r.body_file };
  if (r.body != null) return { kind: "raw", text: o.trimBody ? r.body.trim() : r.body };
  return { kind: "none" };
}

function urlParts(url: string): { host: string; path: string; https: boolean } {
  try {
    const u = new URL(url);
    return { host: u.host, path: `${u.pathname}${u.search}` || "/", https: u.protocol === "https:" };
  } catch {
    return { host: "", path: url, https: false };
  }
}

const lines = (...xs: (string | false | null | undefined | string[])[]) => xs.flat().filter((x): x is string => typeof x === "string").join("\n");

// ---------- generators ----------

function curl(r: HttpRequest, o: SnippetOptions): string {
  const b = bodyOf(r, o);
  const parts = [`curl${o.followRedirects ? " --location" : ""}`];
  // curl picks GET, or POST once there is data; name the method only when it differs.
  if (!(r.method === "GET" && b.kind === "none") && !(r.method === "POST" && b.kind !== "none")) parts[0] += ` --request ${r.method}`;
  parts[0] += ` ${shq(r.url)}`;
  for (const h of r.headers) parts.push(`--header ${shq(`${h.key}: ${h.value}`)}`);
  if (b.kind === "form") for (const p of b.parts) parts.push(`--form ${shq(p.file != null ? `${p.name}=@"${p.file}"` : `${p.name}="${p.value}"`)}`);
  if (b.kind === "file") parts.push(`--data-binary ${shq(`@${b.path}`)}`);
  if (b.kind === "raw") parts.push(`--data ${shq(b.text)}`);
  return parts.join(" \\\n");
}

function http(r: HttpRequest, o: SnippetOptions): string {
  const b = bodyOf(r, o);
  const u = urlParts(r.url);
  const boundary = "----ZenarFormBoundary";
  const headers = r.headers.filter((h) => !(b.kind === "form" && h.key.toLowerCase() === "content-type"));
  const out = [`${r.method} ${u.path} HTTP/1.1`, `Host: ${u.host}`, ...headers.map((h) => `${h.key}: ${h.value}`)];
  if (b.kind === "form") {
    out.push(`Content-Type: multipart/form-data; boundary=${boundary}`, "");
    for (const p of b.parts) {
      out.push(`--${boundary}`);
      if (p.file != null) out.push(`Content-Disposition: form-data; name="${p.name}"; filename="${fileName(p.file)}"`, "Content-Type: <Content-Type header here>", "", `(data of ${p.file})`);
      else out.push(`Content-Disposition: form-data; name="${p.name}"`, "", p.value);
    }
    out.push(`--${boundary}--`);
  } else if (b.kind === "file") out.push("", `"<file contents here: ${b.path}>"`);
  else if (b.kind === "raw") out.push("", b.text);
  return out.join("\n");
}

function fetchJs(r: HttpRequest, o: SnippetOptions): string {
  const i = o.indent;
  const b = bodyOf(r, o);
  const tl = (s: string) => "`" + s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
  const headers = r.headers.filter((h) => !(b.kind === "form" && h.key.toLowerCase() === "content-type"));
  const opts = [`${i}method: ${dq(r.method)}`];
  if (headers.length) opts.push(`${i}headers: myHeaders`);
  if (b.kind === "raw") opts.push(`${i}body: raw`);
  if (b.kind === "form") opts.push(`${i}body: formdata`);
  if (b.kind === "file") opts.push(`${i}body: file`);
  opts.push(`${i}redirect: ${dq(o.followRedirects ? "follow" : "manual")}`);
  return lines(
    headers.length > 0 && ["const myHeaders = new Headers();", ...headers.map((h) => `myHeaders.append(${dq(h.key)}, ${dq(h.value)});`), ""],
    b.kind === "raw" && [`const raw = ${tl(b.text)};`, ""],
    b.kind === "form" && [
      "const formdata = new FormData();",
      ...b.parts.map((p) => (p.file != null ? `formdata.append(${dq(p.name)}, fileInput.files[0], ${dq(p.file)});` : `formdata.append(${dq(p.name)}, ${dq(p.value)});`)),
      "",
    ],
    b.kind === "file" && [`const file = "<file contents here>";`, ""],
    "const requestOptions = {",
    opts.join(",\n"),
    "};",
    "",
    `fetch(${dq(r.url)}, requestOptions)`,
    `${i}.then((response) => response.text())`,
    `${i}.then((result) => console.log(result))`,
    `${i}.catch((error) => console.error(error));`,
  );
}

function axios(r: HttpRequest, o: SnippetOptions): string {
  const i = o.indent;
  const b = bodyOf(r, o);
  const tl = (s: string) => "`" + s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
  const headers = r.headers.filter((h) => !(b.kind === "form" && h.key.toLowerCase() === "content-type"));
  const headerLines = [...headers.map((h) => `${i}${i}${sq(h.key)}: ${sq(h.value)}`), ...(b.kind === "form" ? [`${i}${i}...data.getHeaders()`] : [])];
  const config = [`${i}method: ${sq(r.method.toLowerCase())}`, `${i}maxBodyLength: Infinity`, `${i}url: ${sq(r.url)}`];
  if (headerLines.length) config.push(`${i}headers: {\n${headerLines.join(",\n")}\n${i}}`);
  if (b.kind !== "none") config.push(`${i}data: data`);
  if (!o.followRedirects) config.push(`${i}maxRedirects: 0`);
  return lines(
    "const axios = require('axios');",
    b.kind === "form" && "const FormData = require('form-data');",
    (b.kind === "file" || (b.kind === "form" && b.parts.some((p) => p.file != null))) && "const fs = require('fs');",
    b.kind === "raw" && `let data = ${tl(b.text)};`,
    b.kind === "form" && ["let data = new FormData();", ...b.parts.map((p) => `data.append(${sq(p.name)}, ${p.file != null ? `fs.createReadStream(${sq(p.file)})` : sq(p.value)});`)],
    b.kind === "file" && `let data = fs.readFileSync(${sq(b.path)});`,
    "",
    "let config = {",
    config.join(",\n"),
    "};",
    "",
    "axios.request(config)",
    ".then((response) => {",
    `${i}console.log(JSON.stringify(response.data));`,
    "})",
    ".catch((error) => {",
    `${i}console.log(error);`,
    "});",
  );
}

function python(r: HttpRequest, o: SnippetOptions): string {
  const i = o.indent;
  const b = bodyOf(r, o);
  const pyq = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`;
  const triple = (s: string) => `"""${s.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"')}"""`;
  const headers = r.headers.filter((h) => !(b.kind === "form" && h.key.toLowerCase() === "content-type"));
  const files = b.kind === "form" ? b.parts.filter((p) => p.file != null) : [];
  const args = ["url", "headers=headers", ...(b.kind !== "none" ? ["data=payload"] : []), ...(files.length ? ["files=files"] : []), ...(o.followRedirects ? [] : ["allow_redirects=False"])];
  return lines(
    "import requests",
    "",
    `url = ${pyq(r.url)}`,
    "",
    b.kind === "raw" && `payload = ${b.text.includes("\n") ? triple(b.text) : pyq(b.text)}`,
    b.kind === "form" && `payload = {${b.parts.filter((p) => p.file == null).map((p) => `${pyq(p.name)}: ${pyq(p.value)}`).join(", ")}}`,
    files.length > 0 && ["files = [", files.map((p) => `${i}(${pyq(p.name)}, (${pyq(fileName(p.file!))}, open(${pyq(p.file!)}, 'rb'), 'application/octet-stream'))`).join(",\n"), "]"],
    b.kind === "file" && `payload = open(${pyq(b.path)}, 'rb')`,
    headers.length ? ["headers = {", headers.map((h) => `${i}${pyq(h.key)}: ${pyq(h.value)}`).join(",\n"), "}"] : "headers = {}",
    "",
    `response = requests.request(${pyq(r.method)}, ${args.join(", ")})`,
    "",
    "print(response.text)",
  );
}

function go(r: HttpRequest, o: SnippetOptions): string {
  const i = o.indent;
  const b = bodyOf(r, o);
  const imports = new Set(["fmt", "net/http", "io"]);
  let payload: string[] = [];
  let payloadVar = "nil";
  if (b.kind === "raw") {
    imports.add("strings");
    payloadVar = "payload";
    payload = [`${i}payload := strings.NewReader(${b.text.includes("`") ? dq(b.text) : "`" + b.text + "`"})`, ""];
  } else if (b.kind === "file") {
    imports.add("os");
    payloadVar = "payload";
    payload = [`${i}payload, _ := os.Open(${dq(b.path)})`, `${i}defer payload.Close()`, ""];
  } else if (b.kind === "form") {
    ["bytes", "mime/multipart"].forEach((x) => imports.add(x));
    payloadVar = "payload";
    payload = [`${i}payload := &bytes.Buffer{}`, `${i}writer := multipart.NewWriter(payload)`];
    b.parts.forEach((p, n) => {
      if (p.file == null) payload.push(`${i}_ = writer.WriteField(${dq(p.name)}, ${dq(p.value)})`);
      else {
        ["os", "path/filepath"].forEach((x) => imports.add(x));
        payload.push(
          `${i}file${n}, _ := os.Open(${dq(p.file)})`,
          `${i}defer file${n}.Close()`,
          `${i}part${n}, _ := writer.CreateFormFile(${dq(p.name)}, filepath.Base(${dq(p.file)}))`,
          `${i}_, _ = io.Copy(part${n}, file${n})`,
        );
      }
    });
    payload.push(`${i}if err := writer.Close(); err != nil {`, `${i}${i}fmt.Println(err)`, `${i}${i}return`, `${i}}`, "");
  }
  const headers = r.headers.filter((h) => !(b.kind === "form" && h.key.toLowerCase() === "content-type"));
  const check = [`${i}if err != nil {`, `${i}${i}fmt.Println(err)`, `${i}${i}return`, `${i}}`];
  return lines(
    "package main",
    "",
    "import (",
    [...imports].sort().map((x) => `${i}${dq(x)}`),
    ")",
    "",
    "func main() {",
    "",
    `${i}url := ${dq(r.url)}`,
    `${i}method := ${dq(r.method)}`,
    "",
    payload,
    `${i}client := &http.Client{`,
    !o.followRedirects && [`${i}${i}CheckRedirect: func(req *http.Request, via []*http.Request) error {`, `${i}${i}${i}return http.ErrUseLastResponse`, `${i}${i}},`],
    `${i}}`,
    `${i}req, err := http.NewRequest(method, url, ${payloadVar})`,
    "",
    check,
    headers.map((h) => `${i}req.Header.Add(${dq(h.key)}, ${dq(h.value)})`),
    b.kind === "form" && `${i}req.Header.Set("Content-Type", writer.FormDataContentType())`,
    "",
    `${i}res, err := client.Do(req)`,
    check,
    `${i}defer res.Body.Close()`,
    "",
    `${i}body, err := io.ReadAll(res.Body)`,
    check,
    `${i}fmt.Println(string(body))`,
    "}",
  );
}

function java(r: HttpRequest, o: SnippetOptions): string {
  const i = o.indent;
  const b = bodyOf(r, o);
  const ct = contentType(r) ?? "text/plain";
  let body: string[] = [];
  if (b.kind === "raw") body = [`MediaType mediaType = MediaType.parse(${dq(ct)});`, `RequestBody body = RequestBody.create(mediaType, ${dq(b.text)});`];
  if (b.kind === "file") body = [`MediaType mediaType = MediaType.parse(${dq(ct)});`, `RequestBody body = RequestBody.create(mediaType, new File(${dq(b.path)}));`];
  if (b.kind === "form")
    body = [
      "RequestBody body = new MultipartBody.Builder().setType(MultipartBody.FORM)",
      ...b.parts.map((p) =>
        p.file != null
          ? `${i}.addFormDataPart(${dq(p.name)}, ${dq(fileName(p.file))},\n${i}${i}RequestBody.create(MediaType.parse("application/octet-stream"), new File(${dq(p.file)})))`
          : `${i}.addFormDataPart(${dq(p.name)}, ${dq(p.value)})`,
      ),
      `${i}.build();`,
    ];
  const headers = r.headers.filter((h) => !(b.kind === "form" && h.key.toLowerCase() === "content-type"));
  return lines(
    "OkHttpClient client = new OkHttpClient().newBuilder()",
    !o.followRedirects && `${i}.followRedirects(false)`,
    `${i}.build();`,
    body,
    "Request request = new Request.Builder()",
    `${i}.url(${dq(r.url)})`,
    `${i}.method(${dq(r.method)}, ${b.kind === "none" ? "null" : "body"})`,
    headers.map((h) => `${i}.addHeader(${dq(h.key)}, ${dq(h.value)})`),
    `${i}.build();`,
    "Response response = client.newCall(request).execute();",
  );
}

function csharp(r: HttpRequest, o: SnippetOptions): string {
  const b = bodyOf(r, o);
  const known: Record<string, string> = { GET: "Get", POST: "Post", PUT: "Put", PATCH: "Patch", DELETE: "Delete", HEAD: "Head", OPTIONS: "Options" };
  const method = known[r.method] ? `HttpMethod.${known[r.method]}` : `new HttpMethod(${dq(r.method)})`;
  // Content-Type belongs to the content in HttpClient, not to the request headers.
  const ct = contentType(r);
  const headers = r.headers.filter((h) => h.key.toLowerCase() !== "content-type");
  let content: string[] = [];
  if (b.kind === "raw") content = [`var content = new StringContent(${dq(b.text)}, null, ${ct ? dq(ct) : "\"text/plain\""});`];
  if (b.kind === "file") content = [`var content = new StreamContent(File.OpenRead(${dq(b.path)}));`];
  if (b.kind === "form")
    content = [
      "var content = new MultipartFormDataContent();",
      ...b.parts.map((p) =>
        p.file != null
          ? `content.Add(new StreamContent(File.OpenRead(${dq(p.file)})), ${dq(p.name)}, ${dq(fileName(p.file))});`
          : `content.Add(new StringContent(${dq(p.value)}), ${dq(p.name)});`,
      ),
    ];
  return lines(
    o.followRedirects ? "var client = new HttpClient();" : ["var handler = new HttpClientHandler { AllowAutoRedirect = false };", "var client = new HttpClient(handler);"],
    `var request = new HttpRequestMessage(${method}, ${dq(r.url)});`,
    headers.map((h) => `request.Headers.Add(${dq(h.key)}, ${dq(h.value)});`),
    content,
    b.kind !== "none" && "request.Content = content;",
    "var response = await client.SendAsync(request);",
    "response.EnsureSuccessStatusCode();",
    "Console.WriteLine(await response.Content.ReadAsStringAsync());",
  );
}

function php(r: HttpRequest, o: SnippetOptions): string {
  const i = o.indent;
  const b = bodyOf(r, o);
  const headers = r.headers.filter((h) => !(b.kind === "form" && h.key.toLowerCase() === "content-type"));
  const opts = [
    `${i}CURLOPT_URL => ${sq(r.url)}`,
    `${i}CURLOPT_RETURNTRANSFER => true`,
    `${i}CURLOPT_ENCODING => ''`,
    `${i}CURLOPT_MAXREDIRS => 10`,
    `${i}CURLOPT_TIMEOUT => 0`,
    `${i}CURLOPT_FOLLOWLOCATION => ${o.followRedirects}`,
    `${i}CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1`,
    `${i}CURLOPT_CUSTOMREQUEST => ${sq(r.method)}`,
  ];
  if (b.kind === "raw") opts.push(`${i}CURLOPT_POSTFIELDS => ${sq(b.text)}`);
  if (b.kind === "file") opts.push(`${i}CURLOPT_POSTFIELDS => file_get_contents(${sq(b.path)})`);
  if (b.kind === "form")
    opts.push(`${i}CURLOPT_POSTFIELDS => array(${b.parts.map((p) => `${sq(p.name)} => ${p.file != null ? `new CURLFILE(${sq(p.file)})` : sq(p.value)}`).join(", ")})`);
  if (headers.length) opts.push(`${i}CURLOPT_HTTPHEADER => array(\n${headers.map((h) => `${i}${i}${sq(`${h.key}: ${h.value}`)}`).join(",\n")}\n${i})`);
  return lines("<?php", "", "$curl = curl_init();", "", "curl_setopt_array($curl, array(", opts.join(",\n") + ",", "));", "", "$response = curl_exec($curl);", "", "curl_close($curl);", "echo $response;");
}

function dart(r: HttpRequest, o: SnippetOptions): string {
  const i = o.indent;
  const b = bodyOf(r, o);
  const ds = (s: string) => sq(s).replace(/\$/g, "\\$");
  const ml = (s: string) => `'''${s.replace(/\\/g, "\\\\").replace(/\$/g, "\\$").replace(/'''/g, "\\'\\'\\'")}'''`;
  const headers = r.headers.filter((h) => !(b.kind === "form" && h.key.toLowerCase() === "content-type"));
  const kind = b.kind === "form" ? "MultipartRequest" : "Request";
  return lines(
    b.kind === "file" && ["import 'dart:io';", ""],
    headers.length > 0 && ["var headers = {", headers.map((h) => `${i}${ds(h.key)}: ${ds(h.value)}`).join(",\n"), "};"],
    `var request = http.${kind}(${ds(r.method)}, Uri.parse(${ds(r.url)}));`,
    b.kind === "raw" && `request.body = ${b.text.includes("\n") ? ml(b.text) : ds(b.text)};`,
    b.kind === "file" && `request.bodyBytes = File(${ds(b.path)}).readAsBytesSync();`,
    b.kind === "form" && [
      b.parts.some((p) => p.file == null) && `request.fields.addAll({\n${b.parts.filter((p) => p.file == null).map((p) => `${i}${ds(p.name)}: ${ds(p.value)}`).join(",\n")}\n});`,
      ...b.parts.filter((p) => p.file != null).map((p) => `request.files.add(await http.MultipartFile.fromPath(${ds(p.name)}, ${ds(p.file!)}));`),
    ].filter((x): x is string => !!x),
    !o.followRedirects && "request.followRedirects = false;",
    headers.length > 0 && "request.headers.addAll(headers);",
    "",
    "http.StreamedResponse response = await request.send();",
    "",
    "if (response.statusCode == 200) {",
    `${i}print(await response.stream.bytesToString());`,
    "}",
    "else {",
    `${i}print(response.reasonPhrase);`,
    "}",
  );
}

function swift(r: HttpRequest, o: SnippetOptions): string {
  const i = o.indent;
  const b = bodyOf(r, o);
  const ml = (s: string) => `"""\n${s.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"')}\n"""`;
  const headers = r.headers.filter((h) => !(b.kind === "form" && h.key.toLowerCase() === "content-type"));
  let body: string[] = [];
  if (b.kind === "raw") body = [`let parameters = ${b.text.includes("\n") ? ml(b.text) : dq(b.text)}`, "let postData = parameters.data(using: .utf8)", ""];
  if (b.kind === "file") body = [`let postData = try Data(contentsOf: URL(fileURLWithPath: ${dq(b.path)}))`, ""];
  if (b.kind === "form") {
    body = ['let boundary = "Boundary-\\(UUID().uuidString)"', "var postData = Data()"];
    for (const p of b.parts) {
      const head = p.file != null ? `name=\\"${p.name}\\"; filename=\\"${fileName(p.file)}\\"` : `name=\\"${p.name}\\"`;
      body.push(`postData.append("--\\(boundary)\\r\\nContent-Disposition: form-data; ${head}\\r\\n\\r\\n".data(using: .utf8)!)`);
      body.push(p.file != null ? `postData.append(try Data(contentsOf: URL(fileURLWithPath: ${dq(p.file)})))` : `postData.append(${dq(p.value)}.data(using: .utf8)!)`);
      body.push(`postData.append("\\r\\n".data(using: .utf8)!)`);
    }
    body.push(`postData.append("--\\(boundary)--\\r\\n".data(using: .utf8)!)`, "");
  }
  return lines(
    body,
    `var request = URLRequest(url: URL(string: ${dq(r.url)})!, timeoutInterval: Double.infinity)`,
    headers.map((h) => `request.addValue(${dq(h.value)}, forHTTPHeaderField: ${dq(h.key)})`),
    b.kind === "form" && `request.addValue("multipart/form-data; boundary=\\(boundary)", forHTTPHeaderField: "Content-Type")`,
    "",
    `request.httpMethod = ${dq(r.method)}`,
    b.kind !== "none" && "request.httpBody = postData",
    "",
    "let task = URLSession.shared.dataTask(with: request) { data, response, error in",
    `${i}guard let data = data else {`,
    `${i}${i}print(String(describing: error))`,
    `${i}${i}return`,
    `${i}}`,
    `${i}print(String(data: data, encoding: .utf8)!)`,
    "}",
    "",
    "task.resume()",
  );
}

function ruby(r: HttpRequest, o: SnippetOptions): string {
  const b = bodyOf(r, o);
  const rq = (s: string) => dq(s).replace(/#\{/g, "\\#{");
  const cls = r.method.charAt(0) + r.method.slice(1).toLowerCase();
  const u = urlParts(r.url);
  const headers = r.headers.filter((h) => !(b.kind === "form" && h.key.toLowerCase() === "content-type"));
  return lines(
    'require "uri"',
    'require "net/http"',
    "",
    `url = URI(${rq(r.url)})`,
    "",
    "http = Net::HTTP.new(url.host, url.port)",
    u.https && "http.use_ssl = true",
    `request = Net::HTTP::${cls}.new(url)`,
    headers.map((h) => `request[${rq(h.key)}] = ${rq(h.value)}`),
    b.kind === "raw" && `request.body = ${rq(b.text)}`,
    b.kind === "file" && `request.body = File.read(${rq(b.path)})`,
    b.kind === "form" && [
      `form_data = [${b.parts.map((p) => `[${rq(p.name)}, ${p.file != null ? `File.open(${rq(p.file)})` : rq(p.value)}]`).join(", ")}]`,
      "request.set_form form_data, 'multipart/form-data'",
    ],
    "",
    "response = http.request(request)",
    "puts response.read_body",
  );
}

function powershell(r: HttpRequest, o: SnippetOptions): string {
  const b = bodyOf(r, o);
  const pq = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const headers = r.headers.filter((h) => !(b.kind === "form" && h.key.toLowerCase() === "content-type"));
  const args = [`Invoke-RestMethod ${pq(r.url)}`, `-Method ${pq(r.method)}`];
  if (headers.length) args.push("-Headers $headers");
  if (b.kind === "raw") args.push("-Body $body");
  if (b.kind === "file") args.push(`-InFile ${pq(b.path)}`);
  if (b.kind === "form") args.push("-Form $form");
  if (!o.followRedirects) args.push("-MaximumRedirection 0");
  return lines(
    headers.length > 0 && ['$headers = New-Object "System.Collections.Generic.Dictionary[[String],[String]]"', ...headers.map((h) => `$headers.Add(${pq(h.key)}, ${pq(h.value)})`), ""],
    // A literal here-string: no $ expansion; its closing '@ must start the line.
    b.kind === "raw" && (b.text.includes("\n") ? ["$body = @'", b.text, "'@", ""] : [`$body = ${pq(b.text)}`, ""]),
    b.kind === "form" && [
      "$form = @{",
      ...b.parts.map((p) => `${o.indent}${pq(p.name)} = ${p.file != null ? `Get-Item -Path ${pq(p.file)}` : pq(p.value)}`),
      "}",
      "",
    ],
    `$response = ${args.join(" ")}`,
    "$response | ConvertTo-Json",
  );
}

function rust(r: HttpRequest, o: SnippetOptions): string {
  const i = o.indent;
  const b = bodyOf(r, o);
  const raw = (s: string) => {
    let hashes = "#";
    while (s.includes(`"${hashes}`)) hashes += "#";
    return `r${hashes}"${s}"${hashes}`;
  };
  const std = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
  const method = std.includes(r.method) ? `reqwest::Method::${r.method}` : `reqwest::Method::from_bytes(b${dq(r.method)})?`;
  const headers = r.headers.filter((h) => !(b.kind === "form" && h.key.toLowerCase() === "content-type"));
  const chain = [`${i}let request = client.request(${method}, ${dq(r.url)})`];
  if (headers.length) chain.push(`${i}${i}.headers(headers)`);
  if (b.kind === "raw" || b.kind === "file") chain.push(`${i}${i}.body(data)`);
  if (b.kind === "form") chain.push(`${i}${i}.multipart(form)`);
  chain[chain.length - 1] += ";";
  return lines(
    "#[tokio::main]",
    "async fn main() -> Result<(), Box<dyn std::error::Error>> {",
    `${i}let client = reqwest::Client::builder()`,
    !o.followRedirects && `${i}${i}.redirect(reqwest::redirect::Policy::none())`,
    `${i}${i}.build()?;`,
    "",
    headers.length > 0 && [
      `${i}let mut headers = reqwest::header::HeaderMap::new();`,
      ...headers.map((h) => `${i}headers.insert(${dq(h.key.toLowerCase())}, ${dq(h.value)}.parse()?);`),
      "",
    ],
    b.kind === "raw" && [`${i}let data = ${raw(b.text)};`, ""],
    b.kind === "file" && [`${i}let data = std::fs::read(${dq(b.path)})?;`, ""],
    b.kind === "form" && [
      `${i}let form = reqwest::multipart::Form::new()`,
      ...b.parts.map((p) => (p.file != null ? `${i}${i}.file(${dq(p.name)}, ${dq(p.file)}).await?` : `${i}${i}.text(${dq(p.name)}, ${dq(p.value)})`)).map((x, n, all) => (n === all.length - 1 ? x + ";" : x)),
      "",
    ],
    chain,
    "",
    `${i}let response = request.send().await?;`,
    `${i}let body = response.text().await?;`,
    "",
    `${i}println!("{}", body);`,
    "",
    `${i}Ok(())`,
    "}",
  );
}

const GENERATORS: Record<SnippetLanguage, (r: HttpRequest, o: SnippetOptions) => string> = {
  csharp,
  curl,
  dart,
  go,
  http,
  java,
  fetch: fetchJs,
  axios,
  php,
  powershell,
  python,
  ruby,
  rust,
  swift,
};

export function snippet(language: SnippetLanguage, request: HttpRequest, options: SnippetOptions): string {
  return GENERATORS[language](request, options);
}

// ---------- colouring ----------

const KEYWORDS: Partial<Record<SnippetLanguage, string[]>> = {
  csharp: ["var", "new", "await", "null", "true", "false"],
  dart: ["var", "await", "if", "else", "import", "true", "false", "null"],
  go: ["package", "import", "func", "if", "return", "defer", "nil", "err", "error"],
  java: ["new", "null", "true", "false"],
  fetch: ["const", "let", "new"],
  axios: ["const", "let", "new", "require"],
  php: ["array", "true", "false", "echo", "new"],
  python: ["import", "True", "False", "None"],
  ruby: ["require", "puts", "true", "false", "nil"],
  rust: ["async", "fn", "let", "mut", "await", "Ok", "Result", "Box", "dyn"],
  swift: ["let", "var", "guard", "else", "return", "in", "try"],
  powershell: [],
};

/** String delimiters (start, end, backslash escapes), longest first. */
function delimiters(language: SnippetLanguage): [string, string, boolean][] {
  switch (language) {
    case "curl":
      return [["'", "'", false]];
    case "powershell":
      return [["@'", "'@", false], ["'", "'", false], ['"', '"', true]];
    case "python":
    case "swift":
      return [['"""', '"""', true], ["'", "'", true], ['"', '"', true]];
    case "dart":
      return [["'''", "'''", true], ["'", "'", true], ['"', '"', true]];
    case "go":
      return [["`", "`", false], ['"', '"', true]];
    case "fetch":
    case "axios":
      return [["`", "`", true], ["'", "'", true], ['"', '"', true]];
    case "rust":
      return [['r#"', '"#', false], ['"', '"', true]];
    default:
      return [["'", "'", true], ['"', '"', true]];
  }
}

/** Colour a snippet: strings, numbers, keywords; cURL options and HTTP header names as keys. */
export function highlightSnippet(text: string, language: SnippetLanguage): Line[] {
  if (language === "http") {
    let inBody = false;
    return text.split("\n").map((l, n) => {
      if (n > 0 && l === "") inBody = true;
      if (inBody) return [{ text: l }];
      if (n === 0) {
        const sp = l.indexOf(" ");
        return [{ text: l.slice(0, sp), kind: "key" }, { text: l.slice(sp) }];
      }
      const c = l.indexOf(":");
      return c < 0 ? [{ text: l }] : [{ text: l.slice(0, c), kind: "key" }, { text: l.slice(c) }];
    });
  }
  const delims = delimiters(language);
  const words = new Set(KEYWORDS[language] ?? []);
  const tokens: Token[] = [];
  const push = (t: string, kind?: TokenKind) => t && tokens.push({ text: t, kind });
  let i = 0;
  let plain = "";
  const flush = () => {
    push(plain);
    plain = "";
  };
  while (i < text.length) {
    const d = delims.find(([start]) => text.startsWith(start, i));
    if (d) {
      flush();
      const [start, end, escapes] = d;
      let j = i + start.length;
      while (j < text.length && !text.startsWith(end, j)) j += escapes && text[j] === "\\" ? 2 : 1;
      j = Math.min(text.length, j + end.length);
      push(text.slice(i, j), "string");
      i = j;
      continue;
    }
    const rest = text.slice(i);
    const word = /^[A-Za-z_$][\w$]*/.exec(rest);
    const flag = language === "curl" ? /^(curl|--[a-z-]+)/.exec(rest) : null;
    const num = /^\d+(\.\d+)?/.exec(rest);
    if (flag && (i === 0 || /\s/.test(text[i - 1]))) {
      flush();
      push(flag[0], "key");
      i += flag[0].length;
    } else if (word) {
      if (words.has(word[0])) {
        flush();
        push(word[0], "bool");
      } else plain += word[0];
      i += word[0].length;
    } else if (num && !/[\w$]/.test(text[i - 1] ?? "")) {
      flush();
      push(num[0], "number");
      i += num[0].length;
    } else {
      plain += text[i++];
    }
  }
  flush();
  // Split tokens on newlines into lines (strings may span lines).
  const out: Line[] = [[]];
  for (const t of tokens) {
    t.text.split("\n").forEach((part, n) => {
      if (n > 0) out.push([]);
      if (part) out[out.length - 1].push({ text: part, kind: t.kind });
    });
  }
  return out;
}
