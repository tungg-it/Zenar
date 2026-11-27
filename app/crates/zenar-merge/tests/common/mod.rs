#![allow(dead_code)]
use zenar_format::*;

pub fn kv(id: &str, key: &str, value: &str) -> KeyValue {
    KeyValue { id: id.into(), key: key.into(), value: value.into(), enabled: true, extra: None }
}

pub fn req() -> RequestItem {
    RequestItem {
        id: "r1".into(),
        name: "Get user".into(),
        order: 1.0,
        method: "GET".into(),
        url: "https://api/users".into(),
        folder: "users".into(),
        params: vec![],
        auth: None,
        headers: vec![kv("h1", "Accept", "json"), kv("h2", "X-A", "1")],
        body: Some("{}".into()),
        body_type: Some("json".into()),
        body_extra: None,
        path_variables: vec![], captures: vec![], scripts: Default::default(),
        path: "users/get-user.yaml".into(),
        extra: None,
    }
}
