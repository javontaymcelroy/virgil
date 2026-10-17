//! EPUB: chapters in spine order, each converted from XHTML to paragraphs.

use super::html;
use std::path::Path;

pub fn to_text(path: &Path) -> Result<(Option<String>, String), String> {
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
