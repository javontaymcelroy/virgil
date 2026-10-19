//! A small HTML-to-paragraphs converter for EPUB chapters. EPUB XHTML is well formed and
//! simple, so a tag scanner is enough: block elements become paragraph breaks, source
//! whitespace collapses, and head/script/style content is dropped.

const BLOCKS: &[&str] = &[
    "p",
    "div",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "blockquote",
    "section",
    "article",
    "aside",
    "header",
    "footer",
    "pre",
    "tr",
    "dt",
    "dd",
    "figcaption",
    "hr",
    "table",
    "ul",
    "ol",
];
const SKIPPED: &[&str] = &["head", "script", "style", "noscript", "svg", "math"];

pub fn to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    // Lowercased once for case-insensitive searches; ASCII lowercasing keeps every offset.
    let lower = html.to_ascii_lowercase();
    let mut rest = html;
    while let Some(lt) = rest.find('<') {
        push_text(&mut out, &rest[..lt]);
        rest = &rest[lt..];
        if let Some(body) = rest.strip_prefix("<!--") {
            rest = body.find("-->").map_or("", |end| &body[end + 3..]);
            continue;
        }
        if let Some(body) = rest.strip_prefix("<![CDATA[") {
            let end = body.find("]]>").unwrap_or(body.len());
            push_text(&mut out, &body[..end]);
            rest = body.get(end + 3..).unwrap_or("");
            continue;
        }
        let Some(gt) = rest.find('>') else { break };
        let tag = &rest[1..gt];
        rest = &rest[gt + 1..];

        let closing = tag.starts_with('/');
        let name: String = tag
            .trim_start_matches('/')
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_ascii_lowercase();
        let self_closing = tag.ends_with('/');

        if !closing && !self_closing && SKIPPED.contains(&name.as_str()) {
            let close = format!("</{name}");
            let at = html.len() - rest.len();
            rest = lower[at..]
                .find(&close)
                .and_then(|i| rest[i..].find('>').map(|j| &rest[i + j + 1..]))
                .unwrap_or("");
        } else if name == "br" {
            out.push('\n');
        } else if BLOCKS.contains(&name.as_str()) {
            out.push_str("\n\n");
        }
    }
    push_text(&mut out, rest);
    out
}

/// Appends a text node: entities decoded, whitespace runs collapsed to one space.
fn push_text(out: &mut String, raw: &str) {
    let decoded = decode_entities(raw);
    for c in decoded.chars() {
        if c.is_whitespace() && c != '\u{a0}' {
            if !out.ends_with([' ', '\n']) && !out.is_empty() {
                out.push(' ');
            }
        } else if c != '\u{ad}' {
            out.push(c);
        }
    }
}

fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        let entity = rest[1..]
            .find(';')
            .filter(|&end| end <= 10)
            .and_then(|end| entity(&rest[1..end + 1]).map(|c| (c, end + 2)));
        match entity {
            Some((c, len)) => {
                out.push(c);
                rest = &rest[len..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn entity(name: &str) -> Option<char> {
    if let Some(num) = name.strip_prefix('#') {
        let code = match num.strip_prefix(['x', 'X']) {
            Some(hex) => u32::from_str_radix(hex, 16).ok(),
            None => num.parse().ok(),
        };
        return code.and_then(char::from_u32);
    }
    Some(match name {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" => '\u{a0}',
        "shy" => '\u{ad}',
        "mdash" => '—',
        "ndash" => '–',
        "hellip" => '…',
        "lsquo" => '‘',
        "rsquo" => '’',
        "ldquo" => '“',
        "rdquo" => '”',
        "laquo" => '«',
        "raquo" => '»',
        "copy" => '©',
        "eacute" => 'é',
        "egrave" => 'è',
        "aacute" => 'á',
        "agrave" => 'à',
        "uuml" => 'ü',
        "ouml" => 'ö',
        "auml" => 'ä',
        "ccedil" => 'ç',
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_become_paragraphs_and_source_newlines_collapse() {
        let html = "<html><head><title>X</title><style>p{}</style></head><body>\n<h1>Title</h1>\n<p>One\n  line &amp; <em>more</em>.</p><!-- note --><p>Two&#8212;three&nbsp;four&hellip;</p></body></html>";
        let text = to_text(html);
        let paras: Vec<&str> = text
            .split("\n\n")
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .collect();
        assert_eq!(paras, ["Title", "One line & more.", "Two—three\u{a0}four…"]);
    }

    #[test]
    fn unknown_entities_and_stray_ampersands_survive() {
        assert_eq!(decode_entities("A & B &bogus; &#x41;"), "A & B &bogus; A");
    }

    #[test]
    fn skipped_elements_are_dropped_whatever_their_case() {
        assert_eq!(to_text("a<SCRIPT>x()</SCRIPT>b").trim(), "ab");
    }
}

#[cfg(test)]
mod adversarial {
    use super::*;

    /// S2: every skipped tag lowercases the rest of the chapter to find its close.
    #[test]
    fn skipped_tags_scale_linearly() {
        let html = "<script></script>".repeat(20_000);
        let start = std::time::Instant::now();
        assert_eq!(to_text(&html).trim(), "");
        let took = start.elapsed();
        assert!(took.as_millis() < 500, "20k script tags took {took:?}");
    }

    #[test]
    fn unterminated_tags_and_entities_do_not_panic() {
        for s in [
            "<",
            "<p",
            "<!--",
            "<![CDATA[",
            "&",
            "&#",
            "&#x;",
            "&#xffffffff;",
            "<p>&#0;</p>",
            "</",
            "<p/",
            "<a b='>'>x",
        ] {
            let _ = to_text(s);
        }
        assert_eq!(to_text("<P>Hi<BR/>there</P>"), "\n\nHi\nthere\n\n");
    }
}
