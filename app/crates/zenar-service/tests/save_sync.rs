mod common;
use common::*;
use zenar_service::{Change, SaveOutcome};

#[test]
fn create_is_saved_pushed_and_member_b_gets_it_on_sync() {
    let w = world();
    let out = w.a.service().save(Change::Create(req("r1", "Login", "auth"))).unwrap();
    assert!(matches!(out, SaveOutcome::Saved { commit: Some(_), .. }));

    // commit message and author as specified
    assert_eq!(w.a.git_out(&["log", "-1", "--format=%s"]).trim(), "Create \"Login\" (auth/)");
    assert_eq!(w.a.git_out(&["log", "-1", "--format=%an <%ae>"]).trim(), "Member A <a@x.io>");

    // B has not pulled yet; sync applies it silently
    let report = w.b.service().sync().unwrap();
    assert_eq!(report.data.requests.len(), 1);
    assert_eq!(report.data.requests[0].name, "Login");
    assert_eq!(report.applied, vec!["r1".to_string()]);
    assert!(report.draft_alerts.is_empty());
}
