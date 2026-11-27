use std::collections::HashMap;
use std::fs;

use zenar_http::{CookieJar, HttpRequest, HttpResponse, RunOptions, StoredCookie};
use zenar_store::{HistoryEntry, LocalStore, HISTORY_LIMIT};

fn entry(n: u64) -> HistoryEntry {
    HistoryEntry {
        at_ms: n,
        request_id: "r1".into(),
        request: HttpRequest { method: "GET".into(), url: format!("http://x/{n}"), ..Default::default() },
        response: HttpResponse { status: 200, time_ms: 1, size_bytes: 2, headers: vec![], body: "ok".into() },
    }
}

#[test]
fn captured_variables_persist_and_merge_per_collection() {
    let dir = tempfile::tempdir().unwrap();
    let store = LocalStore::new(dir.path());
    store.merge_captured("/repos/a", &[("token".into(), "1".into())]).unwrap();
    store.merge_captured("/repos/a", &[("token".into(), "2".into()), ("id".into(), "9".into())]).unwrap();
    store.merge_captured("/repos/b", &[("token".into(), "other".into())]).unwrap();

    let reopened = LocalStore::new(dir.path());
    let a = reopened.captured("/repos/a");
    assert_eq!(a, HashMap::from([("token".to_string(), "2".to_string()), ("id".to_string(), "9".to_string())]));
    assert_eq!(reopened.captured("/repos/b")["token"], "other");
    assert!(reopened.captured("/repos/none").is_empty());

    reopened.remove_captured("/repos/a", &["id".into(), "missing".into()]).unwrap();
    assert_eq!(reopened.captured("/repos/a"), HashMap::from([("token".to_string(), "2".to_string())]));

    reopened.clear_captured("/repos/a").unwrap();
    assert!(reopened.captured("/repos/a").is_empty());
    assert_eq!(reopened.captured("/repos/b").len(), 1);
}

#[test]
fn cookie_jars_are_kept_per_collection() {
    let dir = tempfile::tempdir().unwrap();
    let store = LocalStore::new(dir.path());
    let jar = CookieJar {
        cookies: vec![StoredCookie {
            name: "sid".into(),
            value: "v".into(),
            domain: "h".into(),
            host_only: true,
            path: "/".into(),
            secure: false,
            expires_at: None,
        }],
    };
    store.save_cookies("a", &jar).unwrap();
    assert_eq!(LocalStore::new(dir.path()).cookies("a"), jar);
    assert_eq!(store.cookies("b"), CookieJar::default());
}

#[test]
fn history_is_newest_first_and_capped() {
    let dir = tempfile::tempdir().unwrap();
    let store = LocalStore::new(dir.path());
    for n in 0..(HISTORY_LIMIT as u64 + 5) {
        store.append_history("a", entry(n)).unwrap();
    }
    let h = store.history("a");
    assert_eq!(h.len(), HISTORY_LIMIT);
    assert_eq!(h[0].at_ms, HISTORY_LIMIT as u64 + 4);
    store.clear_history("a").unwrap();
    assert!(store.history("a").is_empty());
}

#[test]
fn options_default_then_persist() {
    let dir = tempfile::tempdir().unwrap();
    let store = LocalStore::new(dir.path());
    assert_eq!(store.options(), RunOptions::default());
    let o = RunOptions { insecure_tls: true, proxy: Some("http://p:1".into()) };
    store.set_options(&o).unwrap();
    assert_eq!(LocalStore::new(dir.path()).options(), o);
}

#[test]
fn nothing_is_written_outside_the_store_dir_and_corrupt_files_read_as_empty() {
    let dir = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let store = LocalStore::new(dir.path());
    store.merge_captured(repo.path().to_str().unwrap(), &[("a".into(), "b".into())]).unwrap();
    assert_eq!(fs::read_dir(repo.path()).unwrap().count(), 0);

    // Corrupt file: treated as empty, not a crash.
    for e in walk(dir.path()) {
        fs::write(e, "{not json").unwrap();
    }
    assert!(store.captured(repo.path().to_str().unwrap()).is_empty());
}

fn walk(p: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = vec![];
    for e in fs::read_dir(p).unwrap() {
        let path = e.unwrap().path();
        if path.is_dir() { out.extend(walk(&path)) } else { out.push(path) }
    }
    out
}
