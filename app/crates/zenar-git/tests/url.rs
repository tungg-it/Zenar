use zenar_git::{parse_remote_url, UrlError};

#[test]
fn accepts_https() {
    let u = parse_remote_url("https://gitlab.com/team/api.git").unwrap();
    assert_eq!(u.as_str(), "https://gitlab.com/team/api.git");
    assert_eq!(u.repo_name(), "api");
}

#[test]
fn repo_name_without_suffix_or_trailing_slash() {
    assert_eq!(parse_remote_url("https://h.com/a/b/").unwrap().repo_name(), "b");
}

#[test]
fn scp_style_ssh_rejected_with_https_hint() {
    match parse_remote_url("git@github.com:team/api.git") {
        Err(UrlError::Ssh { https_hint }) => assert_eq!(https_hint, "https://github.com/team/api.git"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn ssh_scheme_rejected_with_https_hint() {
    match parse_remote_url("ssh://git@gitlab.example.com:2222/team/api.git") {
        Err(UrlError::Ssh { https_hint }) => assert_eq!(https_hint, "https://gitlab.example.com/team/api.git"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn other_schemes_rejected() {
    assert!(matches!(parse_remote_url("http://h.com/a"), Err(UrlError::NotHttps)));
    assert!(matches!(parse_remote_url("/local/path"), Err(UrlError::NotHttps)));
    assert!(matches!(parse_remote_url("  "), Err(UrlError::NotHttps)));
}
