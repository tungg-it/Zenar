use wiremock::matchers::{body_string, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};
use zenar_http::{send, FormPart, Header, HttpRequest};

fn req(method: &str, url: String) -> HttpRequest {
    HttpRequest { method: method.into(), url, ..Default::default() }
}

#[tokio::test]
async fn returns_status_headers_body_size_and_time() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/1"))
        .respond_with(ResponseTemplate::new(200).insert_header("x-test", "yes").set_body_string(r#"{"id":1}"#))
        .mount(&server)
        .await;

    let res = send(req("GET", format!("{}/users/1", server.uri()))).await.unwrap();

    assert_eq!(res.status, 200);
    assert_eq!(res.body, r#"{"id":1}"#);
    assert_eq!(res.size_bytes, 8);
    assert!(res.headers.iter().any(|h| h.key == "x-test" && h.value == "yes"));
    assert!(res.time_ms < 5000);
}

#[tokio::test]
async fn sends_method_headers_body_and_query() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/items"))
        .and(query_param("a", "1"))
        .and(header("x-token", "abc"))
        .and(body_string("hello"))
        .respond_with(ResponseTemplate::new(201))
        .mount(&server)
        .await;

    let mut r = req("POST", format!("{}/items?a=1", server.uri()));
    r.headers.push(Header { key: "x-token".into(), value: "abc".into() });
    r.body = Some("hello".into());

    assert_eq!(send(r).await.unwrap().status, 201);
}

#[tokio::test]
async fn non_2xx_is_a_response_not_an_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).respond_with(ResponseTemplate::new(404).set_body_string("nope")).mount(&server).await;
    let res = send(req("GET", server.uri())).await.unwrap();
    assert_eq!(res.status, 404);
    assert_eq!(res.body, "nope");
}

#[tokio::test]
async fn unreachable_host_is_an_error() {
    let err = send(req("GET", "http://127.0.0.1:1/".into())).await.unwrap_err();
    assert!(!err.to_string().is_empty());
}

#[tokio::test]
async fn invalid_method_is_an_error() {
    assert!(send(req("NOT A METHOD", "http://127.0.0.1:1/".into())).await.is_err());
}

#[tokio::test]
async fn header_rows_without_a_name_are_skipped() {
    // An empty row added in the UI ("+ Add" then nothing typed) must not break the request.
    let server = MockServer::start().await;
    Mock::given(method("GET")).respond_with(ResponseTemplate::new(200)).mount(&server).await;
    let mut r = req("GET", server.uri());
    r.headers.push(Header { key: "".into(), value: "".into() });
    r.headers.push(Header { key: "  ".into(), value: "x".into() });
    assert_eq!(send(r).await.unwrap().status, 200);
}

#[tokio::test]
async fn refused_connection_says_so() {
    let err = send(req("GET", "http://127.0.0.1:1/".into())).await.unwrap_err().to_string();
    assert!(err.to_lowercase().contains("refused"), "{err}");
    assert!(err.contains("127.0.0.1:1"), "{err}");
}

#[tokio::test]
async fn invalid_header_value_names_the_header() {
    let mut r = req("GET", "http://127.0.0.1:1/".into());
    r.headers.push(Header { key: "x-bad".into(), value: "line\nbreak".into() });
    let err = send(r).await.unwrap_err().to_string();
    assert!(err.contains("x-bad"), "{err}");
}

#[tokio::test]
async fn multipart_sends_text_and_file_parts() {
    use wiremock::matchers::body_string_contains;
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("avatar.txt");
    std::fs::write(&file, "FILE-BYTES").unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(body_string_contains("name=\"username\""))
        .and(body_string_contains("tung"))
        .and(body_string_contains("filename=\"avatar.txt\""))
        .and(body_string_contains("FILE-BYTES"))
        .respond_with(ResponseTemplate::new(201))
        .mount(&server)
        .await;
    let mut r = req("POST", server.uri());
    // A user-set JSON Content-Type would break the multipart boundary: it is replaced.
    r.headers.push(Header { key: "Content-Type".into(), value: "application/json".into() });
    r.multipart = Some(vec![
        FormPart { name: "username".into(), value: "tung".into(), file: None },
        FormPart { name: "avatar".into(), value: String::new(), file: Some(file.to_string_lossy().into()) },
    ]);
    assert_eq!(send(r).await.unwrap().status, 201);
    let got = &server.received_requests().await.unwrap()[0];
    assert!(got.headers.get("content-type").unwrap().to_str().unwrap().starts_with("multipart/form-data; boundary="));
}

#[tokio::test]
async fn binary_body_sends_file_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("data.bin");
    std::fs::write(&file, [0u8, 1, 2, 255]).unwrap();
    let server = MockServer::start().await;
    Mock::given(method("PUT")).respond_with(ResponseTemplate::new(200)).mount(&server).await;
    let mut r = req("PUT", server.uri());
    r.body_file = Some(file.to_string_lossy().into());
    assert_eq!(send(r).await.unwrap().status, 200);
    let got = &server.received_requests().await.unwrap()[0];
    assert_eq!(got.body, vec![0u8, 1, 2, 255]);
    assert_eq!(got.headers.get("content-type").unwrap(), "application/octet-stream");
}

#[tokio::test]
async fn missing_file_names_the_path() {
    let mut r = req("POST", "http://127.0.0.1:1/".into());
    r.body_file = Some("/no/such/file.bin".into());
    let err = send(r).await.unwrap_err().to_string();
    assert!(err.contains("/no/such/file.bin"), "{err}");
}
