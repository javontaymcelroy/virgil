//! Turns a file on disk into plain text for the reader.
//!
//! Every format comes out the same shape: running prose, paragraphs separated by a blank
//! line. The reader uses those blank lines for its longer pauses, so each importer's job is
//! to keep real paragraph breaks and drop the layout ones (PDF line wraps, HTML source newlines).

mod epub;
mod html;
mod markdown;
mod pdf;

use serde::Serialize;
use std::path::Path;

/// Extensions the Open panel offers and drag-and-drop accepts.
pub const EXTENSIONS: &[&str] = &["txt", "text", "md", "markdown", "pdf", "epub"];

const MAX_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Document {
    pub title: String,
    pub text: String,
    /// The file name, shown under the title.
    pub source: String,
    /// Chapter starts, for formats that have headings (EPUB, Markdown).
    pub headings: Vec<Heading>,
}

/// A heading and the index of its first word in `text` (words are whitespace-separated, the
/// same way the page tokenizes), so the reader can jump to it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Heading {
    pub title: String,
    pub word: usize,
}

const MAX_HEADINGS: usize = 500;

/// What a converter reports: a heading's text and its byte offset into the converted text.
pub type Found = Vec<(String, usize)>;

/// Turns `(title, byte offset)` pairs from a converter into word-indexed headings. Only the
/// word count matters, so `tidy`'s whitespace changes don't move them.
fn headings_at(text: &str, found: Vec<(String, usize)>) -> Vec<Heading> {
    found
        .into_iter()
        .filter(|(t, _)| !t.trim().is_empty())
        .take(MAX_HEADINGS)
        .map(|(title, at)| Heading {
            title: title.split_whitespace().collect::<Vec<_>>().join(" "),
            word: text[..at].split_whitespace().count(),
        })
        .collect()
}

pub fn is_supported(path: &Path) -> bool {
    extension(path).is_some_and(|e| EXTENSIONS.contains(&e.as_str()))
}

pub fn import_path(path: &Path) -> Result<Document, String> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Untitled".into());
    let stem = path
        .file_stem()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.clone());
    let ext = extension(path).unwrap_or_default();
    if !EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!(
            "Virgil can't open {name}. Try a .txt, .md, .pdf or .epub file."
        ));
    }

    let size = std::fs::metadata(path)
        .map_err(|e| format!("Couldn't open {name}: {e}."))?
        .len();
    if size > MAX_BYTES {
        return Err(format!("{name} is larger than 200 MB."));
    }
    let read = || std::fs::read(path).map_err(|e| format!("Couldn't read {name}: {e}."));

    let (title, text, found) = match ext.as_str() {
        "md" | "markdown" => {
            let (title, text, found) = markdown::to_text(&decode(&read()?));
            (title, text, found)
        }
        "pdf" => (None, pdf::to_text(&read()?)?, vec![]),
        "epub" => epub::to_text(path)?,
        _ => (None, decode(&read()?), vec![]),
    };
    let headings = headings_at(&text, found);

    let text = tidy(&text);
    if text.split_whitespace().next().is_none() {
        return Err(format!("{name} has no readable words."));
    }
    let title = title
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or(stem);
    Ok(Document {
        title,
        text,
        source: name,
        headings,
    })
}

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
}

/// Bytes to text: UTF-8 (with or without BOM), UTF-16 with a BOM, else Windows-1252.
fn decode(bytes: &[u8]) -> String {
    match bytes {
        [0xEF, 0xBB, 0xBF, rest @ ..] => String::from_utf8_lossy(rest).into_owned(),
        [0xFF, 0xFE, rest @ ..] => utf16(rest, u16::from_le_bytes),
        [0xFE, 0xFF, rest @ ..] => utf16(rest, u16::from_be_bytes),
        _ => match std::str::from_utf8(bytes) {
            Ok(s) => s.to_string(),
            Err(_) => bytes.iter().map(|&b| cp1252(b)).collect(),
        },
    }
}

fn utf16(bytes: &[u8], word: fn([u8; 2]) -> u16) -> String {
    let units: Vec<u16> = bytes.chunks_exact(2).map(|c| word([c[0], c[1]])).collect();
    String::from_utf16_lossy(&units)
}

fn cp1252(b: u8) -> char {
    const HIGH: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8D}', 'Ž',
        '\u{8F}', '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9D}',
        'ž', 'Ÿ',
    ];
    match b {
        0x80..=0x9F => HIGH[(b - 0x80) as usize],
        _ => b as char,
    }
}

/// Normalise line endings and spacing, keep at most one blank line between paragraphs.
/// Runs of spaces (justified PDFs, indented text) collapse to one.
fn tidy(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut blank_run = 0;
    for line in text.replace("\r\n", "\n").replace('\r', "\n").split('\n') {
        let line = line
            .split([' ', '\t', '\u{a0}'])
            .filter(|w| !w.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        if line.is_empty() {
            blank_run += 1;
            continue;
        }
        if !out.is_empty() {
            out.push_str(if blank_run > 0 { "\n\n" } else { "\n" });
        }
        out.push_str(&line);
        blank_run = 0;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    fn paragraphs(text: &str) -> Vec<&str> {
        text.split("\n\n").collect()
    }

    #[test]
    fn decodes_common_encodings() {
        assert_eq!(decode(b"\xEF\xBB\xBFhi"), "hi");
        assert_eq!(decode(&[0xFF, 0xFE, b'h', 0, b'i', 0]), "hi");
        assert_eq!(decode(&[0xFE, 0xFF, 0, b'h', 0, b'i']), "hi");
        assert_eq!(decode(b"caf\xE9 \x93ok\x94"), "café “ok”");
    }

    #[test]
    fn tidy_keeps_one_blank_line() {
        assert_eq!(tidy("a  \r\nb\r\n\r\n\r\n\r\nc\t"), "a\nb\n\nc");
        assert_eq!(tidy("  two   words\u{a0}\u{a0}here "), "two words here");
        assert_eq!(tidy("\n\n  \nx\n\n"), "x");
    }

    #[test]
    fn rejects_unknown_and_empty_files() {
        assert!(import_path(&fixture("sample.docx"))
            .unwrap_err()
            .contains("can't open"));
        assert!(import_path(&fixture("blank.txt"))
            .unwrap_err()
            .contains("no readable words"));
    }

    #[test]
    fn imports_txt() {
        let doc = import_path(&fixture("sample.txt")).unwrap();
        assert_eq!(doc.title, "sample");
        assert_eq!(doc.source, "sample.txt");
        assert_eq!(paragraphs(&doc.text).len(), 3);
        assert!(doc.text.starts_with("True! nervous"));
    }

    #[test]
    fn imports_markdown() {
        let doc = import_path(&fixture("sample.md")).unwrap();
        assert_eq!(doc.title, "The Tell-Tale Heart");
        assert!(!doc.text.contains(['#', '*', '`', '[']), "{}", doc.text);
        assert!(!doc.text.contains("layout: post"));
        assert!(doc.text.contains("I heard many things in hell."));
        assert!(doc.text.contains("the eye forever"));
    }

    #[test]
    fn imports_pdf() {
        let doc = import_path(&fixture("sample.pdf")).unwrap();
        assert_eq!(doc.title, "sample");
        let paras = paragraphs(&doc.text);
        assert!(paras.len() >= 3, "{paras:#?}");
        assert!(doc.text.contains("How, then, am I mad?"), "{}", doc.text);
        assert!(
            doc.text.contains("very gradually, I made up my mind"),
            "{}",
            doc.text
        );
    }

    #[test]
    fn imports_epub_in_spine_order() {
        let doc = import_path(&fixture("sample.epub")).unwrap();
        assert_eq!(doc.title, "The Tell-Tale Heart");
        let first = doc.text.find("True! nervous").unwrap();
        let later = doc.text.find("Now this is the point.").unwrap();
        assert!(first < later);
        assert!(!doc.text.contains('<'), "{}", doc.text);
    }

    #[test]
    fn headings_point_at_their_first_word() {
        let doc = import_path(&fixture("sample.md")).unwrap();
        let words: Vec<&str> = doc.text.split_whitespace().collect();
        assert!(!doc.headings.is_empty(), "{:?}", doc.headings);
        for h in &doc.headings {
            let first = h.title.split_whitespace().next().unwrap();
            assert_eq!(words[h.word], first, "{h:?}");
        }
        let doc = import_path(&fixture("sample.epub")).unwrap();
        let words: Vec<&str> = doc.text.split_whitespace().collect();
        for h in &doc.headings {
            assert_eq!(
                words[h.word],
                h.title.split_whitespace().next().unwrap(),
                "{h:?}"
            );
        }
        assert!(import_path(&fixture("sample.txt"))
            .unwrap()
            .headings
            .is_empty());
    }
}
