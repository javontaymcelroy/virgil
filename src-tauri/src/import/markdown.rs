//! Markdown to prose: keeps the words, drops the syntax. The first level-one heading, if
//! there is one, becomes the title.

use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, TagEnd};

pub fn to_text(source: &str) -> (Option<String>, String) {
    let options = Options::ENABLE_YAML_STYLE_METADATA_BLOCKS
        | Options::ENABLE_PLUSES_DELIMITED_METADATA_BLOCKS
        | Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_TASKLISTS;

    let mut out = String::with_capacity(source.len());
    let mut title: Option<String> = None;
    let mut in_title = false;
    let mut hidden = 0usize; // inside front matter or an image

    for event in Parser::new_ext(source, options) {
        match event {
            Event::Start(Tag::MetadataBlock(_) | Tag::Image { .. }) => hidden += 1,
            Event::End(TagEnd::MetadataBlock(_) | TagEnd::Image) => hidden -= 1,
            _ if hidden > 0 => {}
            Event::Start(Tag::Heading {
                level: HeadingLevel::H1,
                ..
            }) if title.is_none() => {
                in_title = true;
                title = Some(String::new());
            }
            Event::Text(t) | Event::Code(t) => {
                out.push_str(&t);
                if in_title {
                    title.get_or_insert_with(String::new).push_str(&t);
                }
            }
            Event::SoftBreak | Event::HardBreak => out.push(' '),
            Event::End(TagEnd::Heading(_)) => {
                in_title = false;
                out.push_str("\n\n");
            }
            Event::End(
                TagEnd::Paragraph
                | TagEnd::Item
                | TagEnd::BlockQuote(_)
                | TagEnd::CodeBlock
                | TagEnd::TableRow
                | TagEnd::TableHead
                | TagEnd::FootnoteDefinition,
            )
            | Event::Rule => out.push_str("\n\n"),
            Event::End(TagEnd::TableCell) => out.push(' '),
            _ => {}
        }
    }
    (title, out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_syntax_and_takes_first_h1_as_title() {
        let md = "---\nlayout: post\n---\n\n# A *Good* Title\n\nSome **bold** and `code`,\nwrapped.\n\n![alt text](x.png)\n\n- one\n- two\n\n## Later\n";
        let (title, text) = to_text(md);
        assert_eq!(title.as_deref(), Some("A Good Title"));
        let paras: Vec<&str> = text
            .split("\n\n")
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .collect();
        assert_eq!(
            paras,
            [
                "A Good Title",
                "Some bold and code, wrapped.",
                "one",
                "two",
                "Later"
            ]
        );
    }
}
