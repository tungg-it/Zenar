use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LibraryEntry {
    pub id: String,
    pub name: String,
    pub url: String,
    pub path: PathBuf,
}

#[derive(Debug, thiserror::Error)]
pub enum LibraryError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("collections index is corrupt: {0}")]
    Corrupt(String),
}

/// The list of Collections cloned on this machine, persisted as JSON.
#[derive(Debug)]
pub struct Library {
    file: PathBuf,
    entries: Vec<LibraryEntry>,
}

fn slug(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    let s = s.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    if s.is_empty() {
        "collection".into()
    } else {
        s
    }
}

impl Library {
    pub fn load(file: &Path) -> Result<Library, LibraryError> {
        let entries = match std::fs::read_to_string(file) {
            Ok(s) => serde_json::from_str(&s).map_err(|e| LibraryError::Corrupt(e.to_string()))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(e.into()),
        };
        Ok(Library { file: file.to_path_buf(), entries })
    }

    pub fn list(&self) -> &[LibraryEntry] {
        &self.entries
    }

    pub fn get(&self, id: &str) -> Option<&LibraryEntry> {
        self.entries.iter().find(|e| e.id == id)
    }

    /// Register a Collection; its clone lives at `clones_dir/<id>`.
    pub fn add(&mut self, name: &str, url: &str, clones_dir: PathBuf) -> Result<LibraryEntry, LibraryError> {
        let base = slug(name);
        let mut id = base.clone();
        let mut n = 2;
        while self.get(&id).is_some() {
            id = format!("{base}-{n}");
            n += 1;
        }
        let entry = LibraryEntry { id: id.clone(), name: name.into(), url: url.into(), path: clones_dir.join(&id) };
        self.entries.push(entry.clone());
        self.save()?;
        Ok(entry)
    }

    pub fn take(&mut self, id: &str) -> Result<Option<LibraryEntry>, LibraryError> {
        let Some(i) = self.entries.iter().position(|e| e.id == id) else {
            return Ok(None);
        };
        let e = self.entries.remove(i);
        self.save()?;
        Ok(Some(e))
    }

    fn save(&self) -> Result<(), LibraryError> {
        if let Some(p) = self.file.parent() {
            std::fs::create_dir_all(p)?;
        }
        let s = serde_json::to_string_pretty(&self.entries).map_err(|e| LibraryError::Corrupt(e.to_string()))?;
        std::fs::write(&self.file, s)?;
        Ok(())
    }
}
