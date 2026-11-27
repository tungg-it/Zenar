//! One git operation at a time per Collection clone. Commands run on a thread pool, and auto-sync
//! and the offline queue both fire on window focus: without this, two `git` processes collide on
//! `.git/index.lock` (or interleave fetch/commit/push of different operations).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

/// Run `f` while holding the lock of the repository at `root`. Other repositories are not blocked.
pub fn with_repo_lock<T>(root: &Path, f: impl FnOnce() -> T) -> T {
    let lock = lock_for(root);
    // A panic in an earlier operation must not wedge the Collection forever.
    let _held = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    f()
}

fn lock_for(root: &Path) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
    let key = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut map = LOCKS.get_or_init(Default::default).lock().unwrap_or_else(|p| p.into_inner());
    map.entry(key).or_default().clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    fn max_concurrent(paths: [&'static str; 4]) -> usize {
        let running = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let threads: Vec<_> = paths
            .into_iter()
            .map(|p| {
                let (running, peak) = (running.clone(), peak.clone());
                std::thread::spawn(move || {
                    with_repo_lock(Path::new(p), || {
                        let now = running.fetch_add(1, Ordering::SeqCst) + 1;
                        peak.fetch_max(now, Ordering::SeqCst);
                        std::thread::sleep(Duration::from_millis(50));
                        running.fetch_sub(1, Ordering::SeqCst);
                    })
                })
            })
            .collect();
        threads.into_iter().for_each(|t| t.join().unwrap());
        peak.load(Ordering::SeqCst)
    }

    #[test]
    fn same_repository_runs_one_at_a_time() {
        assert_eq!(max_concurrent(["/zenar-test/a", "/zenar-test/a", "/zenar-test/a", "/zenar-test/a"]), 1);
    }

    #[test]
    fn different_repositories_run_in_parallel() {
        assert!(max_concurrent(["/zenar-test/b1", "/zenar-test/b2", "/zenar-test/b3", "/zenar-test/b4"]) > 1);
    }
}
