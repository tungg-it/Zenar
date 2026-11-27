//! Git module (ADR 0001, 0007): everything goes through the system `git`
//! process, hidden behind the [`GitRunner`] interface.

mod env;
mod library;
mod remove;
mod open;
mod runner;
mod url;
pub use env::{check_environment, EnvError, EnvReport, MIN_GIT_VERSION};
pub use open::{
    author_missing, open_collection_from_remote, open_collection_from_url, Author, AuthorPrompt, OpenKind, OpenRepoError, OpenedRepo, set_author,
};
pub use runner::{GitOutput, GitRunner, RunError, SystemGit};
pub use library::{Library, LibraryEntry, LibraryError};
pub use remove::{remove_collection, unpushed_saves, LocalDataPurger, RemoveError, RemoveOutcome};
pub use url::{parse_remote_url, RemoteUrl, UrlError};
