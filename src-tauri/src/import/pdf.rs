//! PDF text extraction. pdf-extract gives us each page's text with the layout's line wraps
//! still in it; we rejoin those into paragraphs and drop bare page numbers.

use regex::Regex;
use std::sync::LazyLock;

static HYPHEN_WRAP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(\p{L})-\n(\p{Ll})").unwrap());
static LINE_WRAP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"([^\n])\n([^\n])").unwrap());
static PAGE_NUMBER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^\s*\d{1,4}\s*$").unwrap());

pub fn to_text(bytes: &[u8]) -> Result<String, String> {
    // pdf-extract panics on some malformed files rather than returning an error.
    let pages = std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem_by_pages(bytes))
        .map_err(|_| "Couldn't read this PDF. It may be damaged.".to_string())?
        .map_err(|e| match e {
            pdf_extract::OutputError::PdfError(ref inner)
                if inner.to_string().contains("ncrypt") =>
            {
                "This PDF is password-protected. Remove the password and try again.".to_string()
            }
            _ => "Couldn't read this PDF. It may be damaged or password-protected.".to_string(),
        })?;

    let chars: usize = pages
        .iter()
        .map(|p| p.chars().filter(|c| !c.is_whitespace()).count())
        .sum();
    if chars < 20 * pages.len().max(1) {
        return Err("This PDF has no selectable text. It is likely a scanned image; run it through OCR first.".into());
    }

    let text = pages.join("\n");
    let text = PAGE_NUMBER.replace_all(&text, "");
    let text = text.replace("\r\n", "\n").replace(['\r', '\u{c}'], "\n");
    let text = HYPHEN_WRAP.replace_all(&text, "$1$2");
    // Applied twice because each match consumes the character after the newline.
    let text = LINE_WRAP.replace_all(&text, "$1 $2");
    let text = LINE_WRAP.replace_all(&text, "$1 $2");
    Ok(text.into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejoins_wrapped_lines_and_hyphenation() {
        let raw = "The dis-\nease had\nsharpened my senses.\n\n12\n\nNext para-\ngraph.";
        let text = PAGE_NUMBER.replace_all(raw, "");
        let text = HYPHEN_WRAP.replace_all(&text, "$1$2");
        let text = LINE_WRAP.replace_all(&text, "$1 $2");
        let text = LINE_WRAP.replace_all(&text, "$1 $2");
        let text = crate::import::tidy(&text);
        assert_eq!(
            text,
            "The disease had sharpened my senses.\n\nNext paragraph."
        );
    }

    #[test]
    fn rejects_garbage() {
        assert!(to_text(b"not a pdf").is_err());
    }
}
