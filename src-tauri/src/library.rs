//! The library: texts the reader chose to keep. Each lives in `<app data>/library/` as
//! `<id>.txt` (the text) and `<id>.json` (title, source, word count, chapter headings), so
//! listing the shelf never reads a book. Ids are slugs of the title, like theme ids.

use crate::import::{Document, Heading};
use crate::themes::slug;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MAX_BYTES: usize = 200 * 1024 * 1024;
const MAX_TITLE: usize = 200;
const MAX_HEADINGS: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Entry {
    #[serde(default)]
    pub id: String,
    pub title: String,
    pub source: String,
    pub words: usize,
    #[serde(default)]
    pub headings: Vec<Heading>,
}

/// What the page sends to `library_save`: a document as it was imported.
#[derive(Debug, Clone, Deserialize)]
pub struct Incoming {
    pub title: String,
    pub text: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub headings: Vec<Heading>,
}

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("library");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Couldn't create the library folder: {e}."))?;
    Ok(dir)
}

/// Only an id `slug` could have produced reaches the file system.
fn check(id: &str) -> Result<(), String> {
    if slug(id) == id {
        Ok(())
    } else {
        Err("That text isn't in the library.".into())
    }
}

fn save_in(dir: &Path, doc: Incoming) -> Result<Entry, String> {
    let words = doc.text.split_whitespace().count();
    if words == 0 {
        return Err("There's no text to keep.".into());
    }
    if doc.text.len() > MAX_BYTES {
        return Err("That text is larger than 200 MB.".into());
    }
    let title: String = doc.title.trim().chars().take(MAX_TITLE).collect();
    let title = if title.is_empty() {
        "Untitled".to_string()
    } else {
        title
    };
    let base = slug(&title);
    // A second book with the same title gets a numbered id; the same book again is just kept once.
    let mut id = base.clone();
    for n in 2.. {
        if !dir.join(format!("{id}.txt")).exists() {
            break;
        }
        if std::fs::read_to_string(dir.join(format!("{id}.txt"))).is_ok_and(|had| had == doc.text) {
            return read_entry(dir, &id);
        }
        id = format!("{base}-{n}");
    }
    let entry = Entry {
        id: id.clone(),
        title,
        source: doc.source.chars().take(MAX_TITLE).collect(),
        words,
        headings: doc
            .headings
            .into_iter()
            .filter(|h| h.word < words && !h.title.trim().is_empty())
            .take(MAX_HEADINGS)
            .collect(),
    };
    let meta = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{id}.txt")), &doc.text)
        .and_then(|_| std::fs::write(dir.join(format!("{id}.json")), meta))
        .map_err(|e| format!("Couldn't save to the library: {e}."))?;
    Ok(entry)
}

fn read_entry(dir: &Path, id: &str) -> Result<Entry, String> {
    let meta = std::fs::read_to_string(dir.join(format!("{id}.json")))
        .map_err(|e| format!("Couldn't open that text: {e}."))?;
    let mut entry: Entry =
        serde_json::from_str(&meta).map_err(|_| "That library entry is damaged.".to_string())?;
    entry.id = id.to_string();
    Ok(entry)
}

fn list_in(dir: &Path) -> Result<Vec<Entry>, String> {
    let mut ids: Vec<String> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter_map(|n| n.strip_suffix(".json").map(str::to_string))
        .filter(|n| check(n).is_ok() && dir.join(format!("{n}.txt")).exists())
        .collect();
    ids.sort();
    Ok(ids
        .iter()
        .filter_map(|id| read_entry(dir, id).ok())
        .collect())
}

fn open_in(dir: &Path, id: &str) -> Result<Document, String> {
    check(id)?;
    let entry = read_entry(dir, id)?;
    let text = std::fs::read_to_string(dir.join(format!("{id}.txt")))
        .map_err(|e| format!("Couldn't open that text: {e}."))?;
    Ok(Document {
        title: entry.title,
        text,
        source: entry.source,
        headings: entry.headings,
    })
}

fn remove_in(dir: &Path, id: &str) -> Result<(), String> {
    check(id)?;
    std::fs::remove_file(dir.join(format!("{id}.json")))
        .and_then(|_| std::fs::remove_file(dir.join(format!("{id}.txt"))))
        .map_err(|e| format!("Couldn't remove that text: {e}."))
}

/// Every text on the shelf, by title; nothing is read but the metadata files.
#[tauri::command]
pub fn library_list(app: AppHandle) -> Result<Vec<Entry>, String> {
    list_in(&dir(&app)?)
}

/// Keeps `doc` and returns its entry. The same text saved twice is kept once.
#[tauri::command]
pub fn library_save(app: AppHandle, doc: Incoming) -> Result<Entry, String> {
    save_in(&dir(&app)?, doc)
}

#[tauri::command]
pub fn library_open(app: AppHandle, id: String) -> Result<Document, String> {
    open_in(&dir(&app)?, &id)
}

#[tauri::command]
pub fn library_remove(app: AppHandle, id: String) -> Result<(), String> {
    remove_in(&dir(&app)?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("virgil-library-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn doc(title: &str, text: &str) -> Incoming {
        Incoming {
            title: title.into(),
            text: text.into(),
            source: "a.txt".into(),
            headings: vec![
                Heading {
                    title: "One".into(),
                    word: 1,
                },
                Heading {
                    title: "Past the end".into(),
                    word: 99,
                },
            ],
        }
    }

    #[test]
    fn saves_lists_opens_and_removes() {
        let d = folder("roundtrip");
        let e = save_in(&d, doc("  A Tale  ", "one two three")).unwrap();
        assert_eq!((e.id.as_str(), e.words, e.headings.len()), ("a-tale", 3, 1));
        assert_eq!(list_in(&d).unwrap(), vec![e.clone()]);
        let opened = open_in(&d, "a-tale").unwrap();
        assert_eq!(
            (
                opened.title.as_str(),
                opened.text.as_str(),
                opened.source.as_str()
            ),
            ("A Tale", "one two three", "a.txt")
        );
        remove_in(&d, "a-tale").unwrap();
        assert!(list_in(&d).unwrap().is_empty());
        assert!(open_in(&d, "a-tale").is_err());
    }

    #[test]
    fn same_title_different_text_gets_a_numbered_id_and_the_same_text_is_kept_once() {
        let d = folder("dupes");
        assert_eq!(save_in(&d, doc("Book", "first")).unwrap().id, "book");
        assert_eq!(save_in(&d, doc("Book", "second")).unwrap().id, "book-2");
        assert_eq!(save_in(&d, doc("Book", "first")).unwrap().id, "book");
        assert_eq!(list_in(&d).unwrap().len(), 2);
    }

    #[test]
    fn refuses_empty_text_and_ids_that_are_not_slugs() {
        let d = folder("bad");
        assert!(save_in(&d, doc("X", "  \n ")).is_err());
        std::fs::write(d.join("_secret.json"), "{}").unwrap();
        for id in ["../x", "_secret", "Book", "book/", "", "a b"] {
            assert!(open_in(&d, id).is_err(), "{id}");
            assert!(remove_in(&d, id).is_err(), "{id}");
        }
        assert!(d.join("_secret.json").exists());
        assert!(list_in(&d).unwrap().is_empty(), "a stray file isn't listed");
    }

    #[test]
    fn a_damaged_entry_is_skipped_not_fatal() {
        let d = folder("damaged");
        save_in(&d, doc("Good", "fine")).unwrap();
        std::fs::write(d.join("bad.json"), "not json").unwrap();
        std::fs::write(d.join("bad.txt"), "x").unwrap();
        assert_eq!(list_in(&d).unwrap().len(), 1);
        assert!(open_in(&d, "bad").is_err());
    }
}
