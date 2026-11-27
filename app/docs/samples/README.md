# Sample requests: GraphQL, binary, form-data, JSON, response views

Manual test set for the body modes and the response body views. Import `zenar-samples.postman_collection.json` with **Import** in the
sidebar (it is shared with the Collection's Members like any import, so use a test Collection).

File paths inside the JSON are placeholders (`/path/to/Zenar/app/...`)
(`docs/samples/sample.png`, `sample.txt`). On another machine, pick the files again in the Body tab.

| # | Request | Expected |
|---|---------|----------|
| 01 | GraphQL with variables | `200`, `data.country.name = "Vietnam"` |
| 02 | GraphQL, no variables | `200`, Japan and Vietnam |
| 03 | GraphQL, invalid variables JSON | "Could not send request": `GraphQL variables are not valid JSON` |
| 04 | GraphQL, unknown field | `200` with `errors[]` from the server |
| 05 | Binary text file | echo `data` is the file text, Content-Type `application/octet-stream` |
| 06 | Binary PNG | echo `data` is `data:application/octet-stream;base64,...` |
| 07 | Binary PNG, own Content-Type | echo header `Content-Type: image/png` |
| 08 | Binary, missing file | "Could not send request": `cannot read file .../does-not-exist.bin` |
| 09 | Binary, no file chosen | `200`, `Content-Length: 0` |
| 10 | Form-data text + 2 files + disabled field | `form.user = tung`, `files.avatar` and `files.note`, no `skipped`; the `application/json` header is replaced by `multipart/form-data` |
| 11 | Raw JSON object | echo `json` equals the body, header `Content-Type: application/json` added by the app |
| 12 | Nested JSON with Vietnamese text, PUT | echo `json.user.address.city = "Hà Nội"` (UTF-8 kept), `zip` is `null` |
| 13 | JSON array at the top, PATCH | echo `json` is a 2-item array |
| 14 | Invalid JSON (trailing comma) | `200`, sent unchanged: echo `data` is the text, `json` is `null` |
| 15 | JSON with own Content-Type | echo header `Content-Type: application/vnd.api+json` (not replaced) |
| 16 | GET a JSON response | `200`, slideshow JSON: try Preview, wrap, search, Beautify |
| 17 | XML response | view **XML**: one element per line, indented, tags coloured; Preview: `Root › slideshow` over collapsed `[n]` rows, attributes under `$` |
| 18 | SVG (`image/svg+xml`) | view **XML** (picked from the Content-Type), formatted |
| 19 | HTML page | view **HTML**: formatted, `<tag`/`>` in the tag colour; Preview renders the page (no scripts run) |
| 20 | HTML with UTF-8 text | formatted; non-Latin text shows unchanged |
| 21 | Large HTML page (github.com) | still coloured (under the 1 MB colouring limit), `<html …>` attributes on one line, scrolling stays smooth |
| 22 | YAML (OpenAPI) | view **YAML**: keys, strings, numbers, booleans, list dashes coloured |
| 23 | JavaScript | view **JavaScript**: keywords, strings, comments coloured (not reformatted) |
| 24 | Markdown (`text/markdown`) | view **Markdown**: headings, links, code coloured; Preview renders it |
| 25 | Markdown sent as `text/plain` | opens as **Raw**; pick **Markdown** in the view menu to colour and preview it |
| 26 | Plain text | view **Raw** |
| 27 | PNG image | try **Hex** (offsets + ASCII) and **Base64** |

Echo server: https://httpbin.org, GraphQL server: https://countries.trevorblades.com (both public). Response views (17–27)
also use https://cdn.jsdelivr.net, https://petstore3.swagger.io, https://github.com and https://raw.githubusercontent.com.
