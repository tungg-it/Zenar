//! Runner extras (ticket #12): Captured Variables, per-Collection cookies, proxy, TLS toggle.
use std::collections::HashMap;
use std::sync::Arc;

use wiremock::matchers::{body_string, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};
use zenar_format::{Capture, CollectionData, KeyValue, RequestItem};
use zenar_http::{extract_captures, preview, run, send_with, CookieJar, HttpRequest, RunOptions, VarSource};

fn req(method: &str, url: String) -> HttpRequest {
    HttpRequest { method: method.into(), url, ..Default::default() }
}

fn cap(name: &str, path: &str) -> Capture {
    Capture { id: name.into(), name: name.into(), path: path.into(), extra: None }
}

fn collection() -> CollectionData {
    CollectionData {
        name: "c".into(),
        read_only: false,
        requests: vec![],
        broken: vec![],
        folders: vec![],
        environments: vec![],
        headers: vec![],
        auth: None,
    }
}

fn item(method: &str, url: &str) -> RequestItem {
    RequestItem {
        id: "r".into(),
        name: "r".into(),
        order: 1.0,
        method: method.into(),
        url: url.into(),
        folder: String::new(),
        params: vec![],
        headers: vec![],
        auth: None,
        body: None,
        body_type: None,
        body_extra: None,
        path_variables: vec![], captures: vec![], scripts: Default::default(),
        path: String::new(),
        extra: None,
    }
}

// ---- preview ----

#[test]
fn preview_composes_without_sending_and_lists_used_variables() {
    let mut c = collection();
    c.headers = vec![KeyValue { id: "h".into(), key: "X-Team".into(), value: "{{team}}".into(), enabled: true, extra: None }];
    let r = item("GET", "{{base}}/users?q={{ q }}");
    let env = HashMap::from([("base".to_string(), "http://x".to_string()), ("team".to_string(), "core".to_string())]);
    let captured = HashMap::from([("q".to_string(), "1".to_string()), ("base".to_string(), "http://y".to_string())]);
    let p = preview(&c, &r, &env, &captured);
    assert_eq!(p.error, None);
    let sent = p.request.unwrap();
    assert_eq!(sent.url, "http://y/users?q=1");
    assert_eq!(sent.headers[0].value, "core");
    assert_eq!(p.used, vec!["base", "q", "team"]);
    let base = p.variables.iter().find(|v| v.name == "base").unwrap();
    assert_eq!((base.value.as_str(), base.source), ("http://y", VarSource::Captured));
}

#[test]
fn preview_reports_unresolved_variable() {
    let p = preview(&collection(), &item("GET", "{{base}}/x"), &HashMap::new(), &HashMap::new());
    assert!(p.request.is_none());
    assert!(p.error.unwrap().contains("base"));
    assert_eq!(p.used, vec!["base"]);
}

// ---- capture ----

#[test]
fn extracts_values_by_jsonpath_strings_raw_others_as_json() {
    let body = r#"{"data":{"token":"abc","id":7,"tags":["a","b"]}}"#;
    let got = extract_captures(
        body,
        &[cap("token", "$.data.token"), cap("id", "$.data.id"), cap("tags", "$.data.tags[1]"), cap("all", "$.data.tags")],
    );
    assert_eq!(
        got,
        vec![
            ("token".to_string(), "abc".to_string()),
            ("id".to_string(), "7".to_string()),
            ("tags".to_string(), "b".to_string()),
            ("all".to_string(), r#"["a","b"]"#.to_string()),
        ]
    );
}

#[test]
fn missing_path_invalid_path_or_non_json_body_capture_nothing() {
    assert!(extract_captures(r#"{"a":1}"#, &[cap("x", "$.nope"), cap("y", "$[")]).is_empty());
    assert!(extract_captures("<html>", &[cap("x", "$.a")]).is_empty());
}

#[tokio::test]
async fn chained_request_uses_captured_value() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/login"))
        .respond_with(ResponseTemplate::new(200).set_body_string(r#"{"token":"s3cret"}"#))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/me"))
        .and(header("authorization", "Bearer s3cret"))
        .respond_with(ResponseTemplate::new(200).set_body_string("hi"))
        .mount(&server)
        .await;

    let col = collection();
    let mut login = item("POST", &format!("{}/login", server.uri()));
    login.captures.push(cap("token", "$.token"));
    let mut me = item("GET", &format!("{}/me", server.uri()));
    me.headers.push(KeyValue {
        id: "h".into(),
        key: "Authorization".into(),
        value: "Bearer {{token}}".into(),
        enabled: true,
        extra: None,
    });

    let mut captured = HashMap::new();
    let mut jar = CookieJar::default();
    let opts = RunOptions::default();

    let out = run(&col, &login, &HashMap::new(), &captured, &opts, &mut jar).await.unwrap();
    assert_eq!(out.captured, vec![("token".to_string(), "s3cret".to_string())]);
    captured.extend(out.captured);

    let out = run(&col, &me, &HashMap::new(), &captured, &opts, &mut jar).await.unwrap();
    assert_eq!(out.response.status, 200);
    assert_eq!(out.response.body, "hi");
}

#[tokio::test]
async fn captured_variable_overrides_environment_variable() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(body_string("captured"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    let mut r = item("POST", &server.uri());
    r.body = Some("{{v}}".into());
    let env = HashMap::from([("v".to_string(), "env".to_string())]);
    let captured = HashMap::from([("v".to_string(), "captured".to_string())]);
    let out = run(&collection(), &r, &env, &captured, &RunOptions::default(), &mut CookieJar::default()).await.unwrap();
    assert_eq!(out.response.status, 200);
}

#[tokio::test]
async fn unresolved_variable_is_an_error_before_sending() {
    let r = item("GET", "http://127.0.0.1:1/{{missing}}");
    let err = run(&collection(), &r, &HashMap::new(), &HashMap::new(), &RunOptions::default(), &mut CookieJar::default())
        .await
        .unwrap_err();
    assert!(err.to_string().contains("missing"));
}

// ---- cookies ----

#[tokio::test]
async fn cookies_persist_in_the_jar_and_are_scoped_per_jar() {
    let server = MockServer::start().await;
    Mock::given(path("/login"))
        .respond_with(ResponseTemplate::new(200).insert_header("set-cookie", "sid=abc123; Path=/; HttpOnly"))
        .mount(&server)
        .await;
    Mock::given(path("/me"))
        .and(header("cookie", "sid=abc123"))
        .respond_with(ResponseTemplate::new(200).set_body_string("in"))
        .mount(&server)
        .await;
    Mock::given(path("/me")).respond_with(ResponseTemplate::new(401)).mount(&server).await;

    let opts = RunOptions::default();
    let mut jar_a = CookieJar::default();
    send_with(req("GET", format!("{}/login", server.uri())), &opts, &mut jar_a).await.unwrap();

    // Survives a save/load of the jar (the Local store persists it as JSON).
    let mut jar_a: CookieJar = serde_json::from_str(&serde_json::to_string(&jar_a).unwrap()).unwrap();
    let res = send_with(req("GET", format!("{}/me", server.uri())), &opts, &mut jar_a).await.unwrap();
    assert_eq!(res.status, 200);

    // Another Collection's jar does not see it.
    let mut jar_b = CookieJar::default();
    let res = send_with(req("GET", format!("{}/me", server.uri())), &opts, &mut jar_b).await.unwrap();
    assert_eq!(res.status, 401);
}

#[tokio::test]
async fn expired_cookie_is_removed() {
    let server = MockServer::start().await;
    Mock::given(path("/set")).respond_with(ResponseTemplate::new(200).insert_header("set-cookie", "a=1; Path=/")).mount(&server).await;
    Mock::given(path("/clear"))
        .respond_with(ResponseTemplate::new(200).insert_header("set-cookie", "a=; Path=/; Max-Age=0"))
        .mount(&server)
        .await;
    let opts = RunOptions::default();
    let mut jar = CookieJar::default();
    send_with(req("GET", format!("{}/set", server.uri())), &opts, &mut jar).await.unwrap();
    assert_eq!(jar.cookies.len(), 1);
    send_with(req("GET", format!("{}/clear", server.uri())), &opts, &mut jar).await.unwrap();
    assert!(jar.cookies.is_empty());
}

// ---- proxy ----

#[tokio::test]
async fn requests_go_through_the_configured_proxy() {
    let proxy = MockServer::start().await;
    Mock::given(path("/hello")).respond_with(ResponseTemplate::new(200).set_body_string("via proxy")).mount(&proxy).await;
    let opts = RunOptions { proxy: Some(proxy.uri()), ..Default::default() };
    let res = send_with(req("GET", "http://zenar-proxied.invalid/hello".into()), &opts, &mut CookieJar::default())
        .await
        .unwrap();
    assert_eq!(res.body, "via proxy");
}

#[tokio::test]
async fn invalid_proxy_url_is_an_error() {
    let opts = RunOptions { proxy: Some("not a url".into()), ..Default::default() };
    assert!(send_with(req("GET", "http://127.0.0.1:1".into()), &opts, &mut CookieJar::default()).await.is_err());
}

// ---- TLS toggle ----

async fn https_server() -> String {
    let cert = rcgen::generate_simple_self_signed(vec!["localhost".to_string()]).unwrap();
    let der = cert.cert.der().clone();
    let key = tokio_rustls::rustls::pki_types::PrivateKeyDer::try_from(cert.key_pair.serialize_der()).unwrap();
    let config = tokio_rustls::rustls::ServerConfig::builder_with_provider(Arc::new(tokio_rustls::rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(vec![der], key)
        .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        loop {
            let Ok((tcp, _)) = listener.accept().await else { return };
            let acceptor = acceptor.clone();
            tokio::spawn(async move {
                let Ok(mut tls) = acceptor.accept(tcp).await else { return };
                let mut buf = [0u8; 2048];
                let _ = tls.read(&mut buf).await;
                let _ = tls.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").await;
                let _ = tls.shutdown().await;
            });
        }
    });
    format!("https://localhost:{}/", addr.port())
}

#[tokio::test]
async fn self_signed_certificate_fails_unless_tls_verification_is_disabled() {
    let url = https_server().await;
    let strict = RunOptions::default();
    assert!(send_with(req("GET", url.clone()), &strict, &mut CookieJar::default()).await.is_err());

    let lax = RunOptions { insecure_tls: true, ..Default::default() };
    let res = send_with(req("GET", url), &lax, &mut CookieJar::default()).await.unwrap();
    assert_eq!((res.status, res.body.as_str()), (200, "ok"));
}
