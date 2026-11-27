use zenar_git::{Library, LibraryEntry};

#[test]
fn registered_collections_are_listed_and_survive_reload() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("collections.json");
    let mut lib = Library::load(&file).unwrap();
    assert!(lib.list().is_empty());

    let a = lib.add("Payments API", "https://h.io/t/payments.git", dir.path().join("clones")).unwrap();
    let b = lib.add("Payments API", "https://h.io/t/payments2.git", dir.path().join("clones")).unwrap();
    assert_ne!(a.id, b.id, "same display name must not collide");
    assert_eq!(a.id, "payments-api");

    let again = Library::load(&file).unwrap();
    let names: Vec<&LibraryEntry> = again.list().iter().collect();
    assert_eq!(names.len(), 2);
    assert_eq!(names[0].url, "https://h.io/t/payments.git");
    assert_eq!(names[0].path, dir.path().join("clones").join("payments-api"));
}
