mod common;
use common::*;
use proptest::prelude::*;
use zenar_format::*;
use zenar_merge::{merge, overwrite};

fn arb_kv() -> impl Strategy<Value = KeyValue> {
    (0..5u8, "[a-c]{0,2}", "[a-c]{0,2}", any::<bool>())
        .prop_map(|(i, k, v, e)| KeyValue { id: format!("h{i}"), key: k, value: v, enabled: e, extra: None })
}

/// Distinct ids per list, in arbitrary order.
fn arb_headers() -> impl Strategy<Value = Vec<KeyValue>> {
    proptest::collection::vec(arb_kv(), 0..5).prop_map(|v| {
        let mut seen = std::collections::HashSet::new();
        v.into_iter().filter(|h| seen.insert(h.id.clone())).collect()
    })
}

fn arb_request() -> impl Strategy<Value = RequestItem> {
    (
        "[ab]{0,2}",
        0..3u8,
        prop::sample::select(vec!["GET", "POST"]),
        "[ab]{0,2}",
        prop::sample::select(vec!["", "x"]),
        arb_headers(),
        proptest::option::of("[ab]{0,2}"),
    )
        .prop_map(|(name, order, method, url, folder, headers, body)| RequestItem {
            name,
            order: order as f64,
            method: method.into(),
            url,
            folder: folder.into(),
            headers,
            body,
            ..req()
        })
}

fn arb_env() -> impl Strategy<Value = EnvironmentItem> {
    ("[ab]{0,2}", proptest::collection::vec((0..4u8, "[ab]{0,2}"), 0..4)).prop_map(|(name, vs)| {
        let mut seen = std::collections::HashSet::new();
        let variables = vs
            .into_iter()
            .filter(|(i, _)| seen.insert(*i))
            .map(|(i, v)| EnvVar { id: format!("v{i}"), key: "k".into(), value: v, secret: false, extra: None })
            .collect();
        EnvironmentItem { id: "e1".into(), name, order: 1.0, variables, path: "e.yaml".into(), extra: None }
    })
}

fn arb_collection() -> impl Strategy<Value = CollectionData> {
    (proptest::collection::vec((0..4u8, arb_request()), 0..4), proptest::collection::vec(arb_env(), 0..2)).prop_map(
        |(rs, envs)| {
            let mut seen = std::collections::HashSet::new();
            let requests = rs
                .into_iter()
                .filter(|(i, _)| seen.insert(*i))
                .map(|(i, mut r)| {
                    r.id = format!("r{i}");
                    r
                })
                .collect();
            let environments = envs.into_iter().take(1).collect();
            CollectionData { name: "c".into(), read_only: false, requests, broken: vec![], folders: vec![], environments, headers: vec![], auth: None }
        },
    )
}

proptest! {
    #[test]
    fn request_identities(b in arb_request(), o in arb_request(), t in arb_request()) {
        prop_assert_eq!(merge(&b, &o, &o), Ok(o.clone()));
        prop_assert_eq!(merge(&b, &b, &t), Ok(t.clone()));
        prop_assert_eq!(merge(&b, &o, &b), Ok(o.clone()));
        // symmetric when there is no conflict
        if let Ok(m) = merge(&b, &o, &t) {
            prop_assert_eq!(merge(&b, &t, &o), Ok(m));
        }
        // overwrite equals merge when there is no conflict
        if let Ok(m) = merge(&b, &o, &t) {
            prop_assert_eq!(overwrite(&b, &o, &t), m);
        }
    }

    #[test]
    fn collection_identities(b in arb_collection(), o in arb_collection(), t in arb_collection()) {
        prop_assert_eq!(merge(&b, &o, &o), Ok(o.clone()));
        prop_assert_eq!(merge(&b, &b, &t), Ok(t.clone()));
        prop_assert_eq!(merge(&b, &o, &b), Ok(o.clone()));
        if let Ok(m) = merge(&b, &o, &t) {
            let mut m2 = merge(&b, &t, &o).unwrap();
            m2.name = m.name.clone(); // name/read_only/broken are taken from ours by design
            prop_assert_eq!(m2, m);
        }
    }

    #[test]
    fn overwrite_with_theirs_equal_base_is_ours(b in arb_request(), o in arb_request()) {
        prop_assert_eq!(overwrite(&b, &o, &b), o);
    }
}
