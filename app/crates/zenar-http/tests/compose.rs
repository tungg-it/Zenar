//! Request composition: variables, inheritance, override, disabled items. Each test builds a
//! Collection on disk, composes a Request, sends it to a wiremock server, and checks what arrived.
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use wiremock::matchers::{body_string, header, header_exists, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};
use zenar_http::{compose, send, ComposeError};

fn write(root: &Path, rel: &str, content: &str) {
    let p = root.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, content).unwrap();
}

fn vars(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
}

/// Compose the Request at `rel` in the Collection at `root` and send it.
async fn run(root: &Path, rel: &str, v: &HashMap<String, String>) -> u16 {
    let c = zenar_format::open_collection(root).unwrap();
    let r = c.requests.iter().find(|r| r.path == rel).unwrap();
    send(compose(&c, r, v).unwrap()).await.unwrap().status
}

fn req(url: &str, extra: &str) -> String {
    format!("id: r1\nname: R\norder: 1.0\nmethod: GET\nurl: {url}\n{extra}")
}

const MANIFEST: &str = "formatVersion: 1.0\nname: Demo\n";

#[tokio::test]
async fn variables_resolve_in_url_params_headers_body_and_auth() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/users/42"))
        .and(query_param("q", "rust lang"))
        .and(header("x-env", "staging"))
        .and(header("authorization", "Bearer tok-1"))
        .and(body_string("{\"name\": \"ann\"}\n"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "collection.yaml", MANIFEST);
    write(
        dir.path(),
        "a.yaml",
        &req(
            &format!("{}/users/{{{{id}}}}", server.uri()),
            "params:\n- id: p1\n  key: q\n  value: '{{term}}'\n  enabled: true\nheaders:\n- id: h1\n  key: X-Env\n  value: '{{env}}'\n  enabled: true\nauth:\n  type: bearer\n  token: '{{token}}'\nbody:\n  type: json\n  content: |\n    {\"name\": \"{{who}}\"}\n",
        )
        .replace("method: GET", "method: POST"),
    );
    let v = vars(&[("id", "42"), ("term", "rust lang"), ("env", "staging"), ("token", "tok-1"), ("who", "ann")]);
    assert_eq!(run(dir.path(), "a.yaml", &v).await, 200);
}

#[tokio::test]
async fn unresolved_variable_is_an_error_naming_it() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "collection.yaml", MANIFEST);
    write(dir.path(), "a.yaml", &req("http://x/{{missing}}", ""));
    let c = zenar_format::open_collection(dir.path()).unwrap();
    let err = compose(&c, &c.requests[0], &HashMap::new()).unwrap_err();
    assert!(matches!(err, ComposeError::UnresolvedVariable(ref n) if n == "missing"));
}

#[tokio::test]
async fn collection_folder_and_request_inherit_headers_and_auth_nearest_wins() {
    let server = MockServer::start().await;
    // Collection: Bearer + X-Team + X-Level=collection; Folder: Basic + X-Level=folder (wins over collection).
    Mock::given(path("/inherit"))
        .and(header("x-team", "zenar"))
        .and(header("x-level", "folder"))
        .and(header("authorization", "Basic dTpw")) // u:p
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "collection.yaml",
        "formatVersion: 1.0\nname: D\nheaders:\n- id: a\n  key: X-Team\n  value: zenar\n  enabled: true\n- id: b\n  key: X-Level\n  value: collection\n  enabled: true\nauth:\n  type: bearer\n  token: nope\n",
    );
    write(
        dir.path(),
        "api/folder.yaml",
        "name: Api\norder: 0.0\nheaders:\n- id: c\n  key: x-level\n  value: folder\n  enabled: true\nauth:\n  type: basic\n  username: u\n  password: p\n",
    );
    write(dir.path(), "api/v1/a.yaml", &req(&format!("{}/inherit", server.uri()), ""));
    assert_eq!(run(dir.path(), "api/v1/a.yaml", &HashMap::new()).await, 200);
}

#[tokio::test]
async fn request_overrides_inherited_header_and_auth() {
    let server = MockServer::start().await;
    Mock::given(path("/o"))
        .and(header("x-level", "request"))
        .and(header("authorization", "Bearer mine"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "collection.yaml",
        "formatVersion: 1.0\nname: D\nheaders:\n- id: b\n  key: X-Level\n  value: collection\n  enabled: true\nauth:\n  type: basic\n  username: u\n  password: p\n",
    );
    write(
        dir.path(),
        "a.yaml",
        &req(
            &format!("{}/o", server.uri()),
            "headers:\n- id: h\n  key: X-LEVEL\n  value: request\n  enabled: true\nauth:\n  type: bearer\n  token: mine\n",
        ),
    );
    assert_eq!(run(dir.path(), "a.yaml", &HashMap::new()).await, 200);
}

#[tokio::test]
async fn auth_none_on_request_stops_inheritance() {
    let server = MockServer::start().await;
    Mock::given(path("/n")).respond_with(ResponseTemplate::new(200)).mount(&server).await;
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "collection.yaml", "formatVersion: 1.0\nname: D\nauth:\n  type: bearer\n  token: t\n");
    write(dir.path(), "a.yaml", &req(&format!("{}/n", server.uri()), "auth:\n  type: none\n"));
    assert_eq!(run(dir.path(), "a.yaml", &HashMap::new()).await, 200);
    let received = server.received_requests().await.unwrap();
    assert!(!received[0].headers.contains_key("authorization"));
}

#[tokio::test]
async fn disabled_items_are_not_sent_and_disabled_override_suppresses_inherited_header() {
    let server = MockServer::start().await;
    Mock::given(path("/d")).respond_with(ResponseTemplate::new(200)).mount(&server).await;
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "collection.yaml",
        "formatVersion: 1.0\nname: D\nheaders:\n- id: b\n  key: X-Inherited\n  value: v\n  enabled: true\n",
    );
    write(
        dir.path(),
        "a.yaml",
        &req(
            &format!("{}/d", server.uri()),
            "params:\n- id: p\n  key: off\n  value: '1'\n  enabled: false\n- id: p2\n  key: 'on'\n  value: '1'\n  enabled: true\nheaders:\n- id: h\n  key: X-Off\n  value: v\n  enabled: false\n- id: h2\n  key: X-Inherited\n  value: ignored\n  enabled: false\n",
        ),
    );
    assert_eq!(run(dir.path(), "a.yaml", &HashMap::new()).await, 200);
    let received = &server.received_requests().await.unwrap()[0];
    assert_eq!(received.url.query(), Some("on=1"));
    assert!(!received.headers.contains_key("x-off"));
    assert!(!received.headers.contains_key("x-inherited"));
}

#[tokio::test]
async fn rows_without_a_name_are_not_sent() {
    // "+ Add" in the editor leaves an enabled row with an empty key until something is typed.
    let server = MockServer::start().await;
    Mock::given(path("/e")).respond_with(ResponseTemplate::new(200)).mount(&server).await;
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "collection.yaml", MANIFEST);
    write(
        dir.path(),
        "a.yaml",
        &req(
            &format!("{}/e?a=1", server.uri()),
            "params:\n- id: p\n  key: ''\n  value: ''\n  enabled: true\nheaders:\n- id: h\n  key: ''\n  value: ''\n  enabled: true\n",
        ),
    );
    assert_eq!(run(dir.path(), "a.yaml", &HashMap::new()).await, 200);
    let received = &server.received_requests().await.unwrap()[0];
    assert_eq!(received.url.query(), Some("a=1"));
}

#[tokio::test]
async fn api_key_goes_in_header_by_default_or_query_when_asked() {
    let server = MockServer::start().await;
    Mock::given(path("/k"))
        .and(header("x-api-key", "abc"))
        .and(query_param("t", "1"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "collection.yaml",
        "formatVersion: 1.0\nname: D\nauth:\n  type: apikey\n  key: X-Api-Key\n  value: abc\n",
    );
    write(dir.path(), "a.yaml", &req(&format!("{}/k?t=1", server.uri()), ""));
    assert_eq!(run(dir.path(), "a.yaml", &HashMap::new()).await, 200);

    // Request-level apikey in query overrides the inherited header one.
    write(
        dir.path(),
        "b.yaml",
        &req("http://x/k", "auth:\n  type: apikey\n  key: token\n  value: xyz\n  in: query\n").replace("r1", "r2"),
    );
    let c = zenar_format::open_collection(dir.path()).unwrap();
    let r = c.requests.iter().find(|r| r.id == "r2").unwrap();
    let sent = compose(&c, r, &HashMap::new()).unwrap();
    assert_eq!(sent.url, "http://x/k?token=xyz");
    assert!(sent.headers.iter().all(|h| !h.key.eq_ignore_ascii_case("x-api-key")));
}

#[tokio::test]
async fn form_body_is_urlencoded_and_content_type_defaulted() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/f"))
        .and(header("content-type", "application/x-www-form-urlencoded"))
        .and(body_string("a=1&b=x+y%26z"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "collection.yaml", MANIFEST);
    write(
        dir.path(),
        "a.yaml",
        &req(&format!("{}/f", server.uri()), "body:\n  type: form\n  content: |\n    a=1\n    b={{v}}\n")
            .replace("GET", "POST"),
    );
    assert_eq!(run(dir.path(), "a.yaml", &vars(&[("v", "x y&z")])).await, 200);
}

#[tokio::test]
async fn json_body_gets_content_type() {
    let server = MockServer::start().await;
    Mock::given(path("/j")).and(header_exists("content-type")).respond_with(ResponseTemplate::new(200)).mount(&server).await;
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "collection.yaml", MANIFEST);
    write(
        dir.path(),
        "a.yaml",
        &req(&format!("{}/j", server.uri()), "body:\n  type: json\n  content: '{}'\n").replace("GET", "POST"),
    );
    assert_eq!(run(dir.path(), "a.yaml", &HashMap::new()).await, 200);
    let got = &server.received_requests().await.unwrap()[0];
    assert_eq!(got.headers.get("content-type").unwrap().to_str().unwrap(), "application/json");
}

#[tokio::test]
async fn raw_body_languages_get_their_content_type() {
    // Postman's raw language picker: Text, JavaScript, HTML, XML each set a Content-Type; "raw" sets none.
    for (kind, expected) in [
        ("text", Some("text/plain")),
        ("javascript", Some("application/javascript")),
        ("html", Some("text/html")),
        ("xml", Some("application/xml")),
        ("raw", None),
    ] {
        let server = MockServer::start().await;
        Mock::given(path("/r")).respond_with(ResponseTemplate::new(200)).mount(&server).await;
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "collection.yaml", MANIFEST);
        write(
            dir.path(),
            "a.yaml",
            &req(&format!("{}/r", server.uri()), &format!("body:\n  type: {kind}\n  content: 'x'\n")).replace("GET", "POST"),
        );
        assert_eq!(run(dir.path(), "a.yaml", &HashMap::new()).await, 200);
        let got = &server.received_requests().await.unwrap()[0];
        assert_eq!(got.headers.get("content-type").map(|v| v.to_str().unwrap()), expected, "{kind}");
    }
}

#[tokio::test]
async fn form_data_body_is_multipart_with_variables_and_files() {
    use wiremock::matchers::body_string_contains;
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("cv.pdf");
    fs::write(&file, "PDF").unwrap();
    let server = MockServer::start().await;
    Mock::given(path("/up"))
        .and(body_string_contains("name=\"user\""))
        .and(body_string_contains("ann"))
        .and(body_string_contains("filename=\"cv.pdf\""))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    write(dir.path(), "collection.yaml", MANIFEST);
    let body = format!(
        "body:\n  type: formdata\n  content: ''\n  fields:\n  - id: f1\n    key: user\n    value: '{{{{who}}}}'\n    type: text\n  - id: f2\n    key: off\n    value: x\n    type: text\n    enabled: false\n  - id: f3\n    key: cv\n    value: '{}'\n    type: file\n",
        file.display()
    );
    write(dir.path(), "a.yaml", &req(&format!("{}/up", server.uri()), &body).replace("GET", "POST"));
    assert_eq!(run(dir.path(), "a.yaml", &vars(&[("who", "ann")])).await, 200);
    let got = &server.received_requests().await.unwrap()[0];
    assert!(!String::from_utf8_lossy(&got.body).contains("name=\"off\""));
}

#[tokio::test]
async fn binary_body_sends_the_chosen_file() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("img.png");
    fs::write(&file, [137u8, 80, 78, 71]).unwrap();
    let server = MockServer::start().await;
    Mock::given(path("/bin")).respond_with(ResponseTemplate::new(200)).mount(&server).await;
    write(dir.path(), "collection.yaml", MANIFEST);
    let body = format!("body:\n  type: binary\n  content: ''\n  file: '{}'\n", file.display());
    write(dir.path(), "a.yaml", &req(&format!("{}/bin", server.uri()), &body).replace("GET", "POST"));
    assert_eq!(run(dir.path(), "a.yaml", &HashMap::new()).await, 200);
    assert_eq!(server.received_requests().await.unwrap()[0].body, vec![137u8, 80, 78, 71]);
}

#[tokio::test]
async fn graphql_body_is_json_with_query_and_variables() {
    let server = MockServer::start().await;
    Mock::given(path("/gql"))
        .and(header("content-type", "application/json"))
        .and(body_string(r#"{"query":"query { user(id: 7) { name } }","variables":{"id":"7"}}"#))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "collection.yaml", MANIFEST);
    let body = "body:\n  type: graphql\n  content: 'query { user(id: {{id}}) { name } }'\n  variables: '{\"id\": \"{{id}}\"}'\n";
    write(dir.path(), "a.yaml", &req(&format!("{}/gql", server.uri()), body).replace("GET", "POST"));
    assert_eq!(run(dir.path(), "a.yaml", &vars(&[("id", "7")])).await, 200);
}

#[test]
fn graphql_variables_must_be_json() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "collection.yaml", MANIFEST);
    write(dir.path(), "a.yaml", &req("http://x/g", "body:\n  type: graphql\n  content: 'query { a }'\n  variables: '{not json'\n"));
    let c = zenar_format::open_collection(dir.path()).unwrap();
    let err = compose(&c, &c.requests[0], &HashMap::new()).unwrap_err();
    assert!(matches!(err, ComposeError::InvalidGraphqlVariables(_)), "{err:?}");
}

#[test]
fn path_variables_fill_their_segments_before_variables_resolve() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "collection.yaml", MANIFEST);
    write(
        dir.path(),
        "a.yaml",
        &req(
            "'{{base}}/users/:id/posts/:post?q=:id#:id'",
            "path_variables:\n- id: v1\n  key: id\n  value: '{{uid}}'\n  enabled: true\n",
        ),
    );
    let c = zenar_format::open_collection(dir.path()).unwrap();
    let v = vars(&[("base", "http://h:8080"), ("uid", "42")]);
    let out = compose(&c, &c.requests[0], &v).unwrap();
    // `:post` has no Path Variable: sent as written. The query and fragment are not path segments.
    assert_eq!(out.url, "http://h:8080/users/42/posts/:post?q=:id#:id");
}
