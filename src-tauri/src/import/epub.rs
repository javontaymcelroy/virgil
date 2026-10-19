//! EPUB: chapters in spine order, each converted from XHTML to paragraphs.

use super::html;
use std::io::{self, Read};
use std::path::Path;

/// The 200 MB cap in mod.rs is on the compressed file; these bound what it may inflate to.
const MAX_ENTRY: u64 = 32 * 1024 * 1024;
const MAX_TOTAL: u64 = 256 * 1024 * 1024;
const TOO_BIG: &str = "This EPUB is too large to open.";

/// Inflates every entry into a sink first, stopping at the caps, so nothing the epub crate
/// reads afterwards can be bigger than it claims. (A zip header's size field is untrusted.)
fn check_inflated_size(path: &Path) -> Result<(), String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut total = 0;
    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let n =
            io::copy(&mut entry.take(MAX_ENTRY + 1), &mut io::sink()).map_err(|e| e.to_string())?;
        total += n;
        if n > MAX_ENTRY || total > MAX_TOTAL {
            return Err(TOO_BIG.into());
        }
    }
    Ok(())
}

pub fn to_text(path: &Path) -> Result<(Option<String>, String), String> {
    check_inflated_size(path)?;
    let mut doc = epub::doc::EpubDoc::new(path)
        .map_err(|_| "Couldn't read this EPUB. It may be damaged or DRM-protected.".to_string())?;
    let title = doc.get_title();
    let mut text = String::new();
    for chapter in 0..doc.get_num_chapters() {
        doc.set_current_chapter(chapter);
        if let Some((xhtml, _mime)) = doc.get_current_str() {
            text.push_str(&html::to_text(&xhtml));
            text.push_str("\n\n");
        }
    }
    Ok((title, text))
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    /// An EPUB whose single chapter is `size` bytes of text, compressed. Returns its path.
    fn epub_with_chapter(size: usize) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("virgil-bomb-{size}.epub"));
        let file = std::fs::File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        let deflated = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("mimetype", stored).unwrap();
        zip.write_all(b"application/epub+zip").unwrap();
        zip.start_file("META-INF/container.xml", deflated).unwrap();
        zip.write_all(br#"<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#).unwrap();
        zip.start_file("content.opf", deflated).unwrap();
        zip.write_all(br#"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Bomb</dc:title><dc:identifier id="id">x</dc:identifier></metadata><manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>"#).unwrap();
        zip.start_file("c.xhtml", deflated).unwrap();
        zip.write_all(b"<html><body><p>").unwrap();
        let line = b"word ".repeat(1024);
        for _ in 0..size / line.len() {
            zip.write_all(&line).unwrap();
        }
        zip.write_all(b"</p></body></html>").unwrap();
        zip.finish().unwrap();
        path
    }

    /// S1: the 200 MB cap is on the compressed file, so a tiny EPUB can inflate without limit.
    #[test]
    fn refuses_a_chapter_that_inflates_past_the_cap() {
        let path = epub_with_chapter(64 * 1024 * 1024);
        let packed = std::fs::metadata(&path).unwrap().len();
        assert!(packed < 1024 * 1024, "{packed} bytes packed");
        let result = super::super::import_path(&path);
        let _ = std::fs::remove_file(&path);
        assert_eq!(result.unwrap_err(), super::TOO_BIG);
    }

    #[test]
    fn a_normal_chapter_still_opens() {
        let path = epub_with_chapter(64 * 1024);
        let doc = super::super::import_path(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(doc.title, "Bomb");
        assert!(doc.text.starts_with("word word"));
    }
}
