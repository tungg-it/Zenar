use std::time::{Duration, Instant};
use zenar_git::{GitRunner, SystemGit};

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let git = SystemGit::new();
    assert!(git.run(Some(dir.path()), &["init", "-q"]).unwrap().success);
    std::fs::write(dir.path().join("a.txt"), "a").unwrap();
    dir
}

#[test]
fn waits_for_a_lock_held_by_another_git_process() {
    // Another git (an IDE, a terminal) holds index.lock briefly: the call waits instead of failing.
    let dir = repo();
    let lock = dir.path().join(".git/index.lock");
    std::fs::write(&lock, "").unwrap();
    let held = lock.clone();
    let releaser = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        std::fs::remove_file(held).unwrap();
    });
    let out = SystemGit::new().run(Some(dir.path()), &["add", "a.txt"]).unwrap();
    releaser.join().unwrap();
    assert!(out.success, "{}", out.stderr);
}

#[test]
fn a_lock_that_never_goes_away_fails_after_a_bounded_wait() {
    let dir = repo();
    std::fs::write(dir.path().join(".git/index.lock"), "").unwrap();
    let started = Instant::now();
    let out = SystemGit::new().run(Some(dir.path()), &["add", "a.txt"]).unwrap();
    assert!(!out.success);
    assert!(out.stderr.contains("index.lock"), "{}", out.stderr);
    assert!(started.elapsed() < Duration::from_secs(10));
}
