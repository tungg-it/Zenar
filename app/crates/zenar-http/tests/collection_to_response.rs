//! Tracer end-to-end through the core (what the Tauri commands do): open a Collection folder
//! from disk, take a Request, send it to a local server, check the response.
use std::fs;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};
use zenar_http::{send, Header, HttpRequest};

#[tokio::test]
async fn request_from_disk_collection_is_sent_and_answered() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/1"))
        .and(header("accept", "application/json"))
        .respond_with(ResponseTemplate::new(200).set_body_string(r#"{"id":1}"#))
        .mount(&server)
        .await;

    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("collection.yaml"), "formatVersion: 1.0\nname: Demo\n").unwrap();
    fs::write(
        dir.path().join("get-user.yaml"),
        format!(
            "id: r1\nname: Get user\norder: 1.0\nmethod: GET\nurl: {}/users/1\nheaders:\n  - id: h1\n    key: Accept\n    value: application/json\n    enabled: true\n",
            server.uri()
        ),
    )
    .unwrap();

    let c = zenar_format::open_collection(dir.path()).unwrap();
    let r = &c.requests[0];
    let res = send(HttpRequest {
        method: r.method.clone(),
        url: r.url.clone(),
        headers: r.headers.iter().filter(|h| h.enabled).map(|h| Header { key: h.key.clone(), value: h.value.clone() }).collect(),
        body: r.body.clone(),
        ..Default::default()
    })
    .await
    .unwrap();

    assert_eq!(res.status, 200);
    assert_eq!(res.body, r#"{"id":1}"#);
}
