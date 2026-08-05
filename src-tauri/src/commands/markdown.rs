//! Server-side markdown parsing.
//!
//! Parses chat markdown with `pulldown-cmark` and stores the result as a
//! flat `Vec<(Range<usize>, MarkdownEvent)>`. Re-parses are cheap and the
//! renderer never touches a markdown library.
//!
//! We follow the same approach: this module exposes a `parse_markdown` Tauri
//! command that returns a flat block list. Each block is a self-contained
//! piece of structured content (heading, paragraph, code fence with language,
//! list, blockquote, table, mermaid, kiro_summary, etc.). The renderer maps
//! each block to a React component — no `react-markdown` parser needed.
//!
//! ## Why blocks instead of raw events
//!
//! pulldown-cmark emits ~50 distinct event types. Surfacing them all means
//! the renderer has to reconstruct nesting, which defeats the purpose of
//! moving parsing to the backend. Instead, we collapse the event stream into
//! the dozen or so block kinds the chat UI actually renders. Inline content
//! within a block is stored as a flat `Vec<InlineSpan>` (text + emphasis +
//! code + link).
//!
//! Specialized blocks (`mermaid`, `kiro_summary`, JSON report fences) are
//! recognized at parse time so the renderer can handle them directly.

use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde::Serialize;

// ── Public types ─────────────────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct InlineStyle {
    #[serde(default, skip_serializing_if = "is_false")]
    pub bold: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub italic: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub strike: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub code: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_href: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_title: Option<String>,
}

fn is_false(b: &bool) -> bool { !b }

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InlineSpan {
    pub text: String,
    #[serde(default, skip_serializing_if = "InlineStyle::is_empty")]
    pub style: InlineStyle,
}

impl InlineStyle {
    fn is_empty(&self) -> bool {
        !self.bold && !self.italic && !self.strike && !self.code
            && self.link_href.is_none() && self.link_title.is_none()
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ListItem {
    pub spans: Vec<InlineSpan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
    /// Nested blocks inside this list item (sub-lists, paragraphs).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<MarkdownBlock>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TableRow {
    pub cells: Vec<Vec<InlineSpan>>,
}

/// Block-level markdown content. The renderer maps each variant to a component.
///
/// We use an internally-tagged enum so the JS side gets `{ type: 'paragraph', ... }`.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MarkdownBlock {
    Paragraph {
        spans: Vec<InlineSpan>,
    },
    Heading {
        level: u8,
        spans: Vec<InlineSpan>,
    },
    CodeBlock {
        /// Empty when no language was specified.
        language: String,
        text: String,
    },
    Blockquote {
        children: Vec<MarkdownBlock>,
    },
    List {
        ordered: bool,
        /// Starting number for ordered lists; `None` for unordered.
        start: Option<u64>,
        items: Vec<ListItem>,
    },
    HorizontalRule,
    Table {
        header: Vec<Vec<InlineSpan>>,
        rows: Vec<TableRow>,
    },
    Html {
        text: String,
    },
    /// Specialized: code fence with `mermaid` language tag. Renderer should
    /// invoke its mermaid renderer instead of the generic code block.
    Mermaid {
        text: String,
    },
    /// Specialized: a `<kiro_summary>...</kiro_summary>` block embedded in
    /// the assistant's reply. Replaces the renderer-side regex extraction in
    /// `TaskCompletionCard.tsx`.
    KiroSummary {
        json: String,
    },
    /// Specialized: ` ```kirodex-report ` fenced JSON. Same idea as KiroSummary
    /// but for the structured task completion report.
    KirodexReport {
        json: String,
    },
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ParsedMarkdown {
    pub blocks: Vec<MarkdownBlock>,
}

// ── Parser ───────────────────────────────────────────────────────────────────

const PARSE_OPTIONS: Options = Options::ENABLE_TABLES
    .union(Options::ENABLE_FOOTNOTES)
    .union(Options::ENABLE_STRIKETHROUGH)
    .union(Options::ENABLE_TASKLISTS)
    .union(Options::ENABLE_SMART_PUNCTUATION)
    .union(Options::ENABLE_HEADING_ATTRIBUTES)
    .union(Options::ENABLE_GFM);

/// Convert a heading level enum to a small integer.
fn heading_int(l: HeadingLevel) -> u8 {
    match l {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

/// Per-frame state that lets us drive a recursive-style parse on top of the
/// flat event stream. Each pushed block accumulates events until its matching
/// `End` is seen.
enum Frame {
    Document {
        blocks: Vec<MarkdownBlock>,
    },
    Paragraph {
        spans: Vec<InlineSpan>,
        style: InlineStyle,
    },
    Heading {
        level: u8,
        spans: Vec<InlineSpan>,
        style: InlineStyle,
    },
    Blockquote {
        blocks: Vec<MarkdownBlock>,
    },
    List {
        ordered: bool,
        start: Option<u64>,
        items: Vec<ListItem>,
    },
    Item {
        spans: Vec<InlineSpan>,
        children: Vec<MarkdownBlock>,
        style: InlineStyle,
        checked: Option<bool>,
    },
    Table {
        header: Vec<Vec<InlineSpan>>,
        rows: Vec<TableRow>,
        in_header: bool,
        current_row: Vec<Vec<InlineSpan>>,
        current_cell: Vec<InlineSpan>,
        style: InlineStyle,
    },
    CodeBlock {
        language: String,
        text: String,
    },
}

/// The currently-active inline style, reused across spans within a frame.
fn push_inline(spans: &mut Vec<InlineSpan>, style: &InlineStyle, text: &str) {
    if text.is_empty() { return; }
    // Coalesce with the previous span if styles match — keeps the JSON tight.
    if let Some(last) = spans.last_mut() {
        if styles_equal(&last.style, style) {
            last.text.push_str(text);
            return;
        }
    }
    spans.push(InlineSpan {
        text: text.to_string(),
        style: style.clone(),
    });
}

fn styles_equal(a: &InlineStyle, b: &InlineStyle) -> bool {
    a.bold == b.bold
        && a.italic == b.italic
        && a.strike == b.strike
        && a.code == b.code
        && a.link_href == b.link_href
        && a.link_title == b.link_title
}

/// Detect specialized blocks before falling through to the generic one.
fn classify_code_block(language: &str, text: &str) -> MarkdownBlock {
    let lang = language.trim().to_ascii_lowercase();
    match lang.as_str() {
        "mermaid" => MarkdownBlock::Mermaid {
            text: text.to_string(),
        },
        "kirodex-report" | "kirodex_report" => MarkdownBlock::KirodexReport {
            json: text.to_string(),
        },
        _ => MarkdownBlock::CodeBlock {
            language: language.to_string(),
            text: text.to_string(),
        },
    }
}

/// Pull `<kiro_summary>{...}</kiro_summary>` blocks out of the input *before*
/// markdown parsing. They're not valid CommonMark and pulldown-cmark would
/// emit them as inline HTML, which is harder to consume on the renderer side.
///
/// Returns the markdown with summary blocks stripped, plus the JSON payloads
/// in their original order.
fn extract_kiro_summaries(input: &str) -> (String, Vec<String>) {
    let mut summaries = Vec::new();
    let mut out = String::with_capacity(input.len());
    let mut cursor = 0;
    while let Some(start) = input[cursor..].find("<kiro_summary>") {
        let abs_start = cursor + start;
        out.push_str(&input[cursor..abs_start]);
        let after_open = abs_start + "<kiro_summary>".len();
        if let Some(rel_end) = input[after_open..].find("</kiro_summary>") {
            let abs_end = after_open + rel_end;
            summaries.push(input[after_open..abs_end].trim().to_string());
            cursor = abs_end + "</kiro_summary>".len();
        } else {
            // Unterminated — bail and keep the rest verbatim.
            out.push_str(&input[abs_start..]);
            return (out, summaries);
        }
    }
    out.push_str(&input[cursor..]);
    (out, summaries)
}

/// Parse a markdown string into a flat block list.
pub fn parse(input: &str) -> ParsedMarkdown {
    let (preprocessed, summaries) = extract_kiro_summaries(input);

    // Stack-based descent. The bottom of the stack is always `Document`.
    let mut stack: Vec<Frame> = vec![Frame::Document { blocks: Vec::new() }];

    let parser = Parser::new_ext(&preprocessed, PARSE_OPTIONS);

    fn current_style(stack: &[Frame]) -> InlineStyle {
        // Find the closest frame that owns inline state. Code blocks override.
        for frame in stack.iter().rev() {
            match frame {
                Frame::Paragraph { style, .. }
                | Frame::Heading { style, .. }
                | Frame::Item { style, .. }
                | Frame::Table { style, .. } => return style.clone(),
                _ => {}
            }
        }
        InlineStyle::default()
    }

    fn modify_style<F: FnOnce(&mut InlineStyle)>(stack: &mut [Frame], f: F) {
        for frame in stack.iter_mut().rev() {
            match frame {
                Frame::Paragraph { style, .. }
                | Frame::Heading { style, .. }
                | Frame::Item { style, .. }
                | Frame::Table { style, .. } => {
                    f(style);
                    return;
                }
                _ => {}
            }
        }
    }

    fn push_text_to_active(stack: &mut [Frame], text: &str) {
        let style = current_style(stack);
        for frame in stack.iter_mut().rev() {
            match frame {
                Frame::Paragraph { spans, .. }
                | Frame::Heading { spans, .. }
                | Frame::Item { spans, .. } => {
                    push_inline(spans, &style, text);
                    return;
                }
                Frame::Table { current_cell, .. } => {
                    push_inline(current_cell, &style, text);
                    return;
                }
                Frame::CodeBlock { text: t, .. } => {
                    t.push_str(text);
                    return;
                }
                _ => {}
            }
        }
    }

    fn finish_block(stack: &mut Vec<Frame>, block: MarkdownBlock) {
        // Append the finished block to the closest container frame.
        for frame in stack.iter_mut().rev() {
            match frame {
                Frame::Document { blocks } => {
                    blocks.push(block);
                    return;
                }
                Frame::Blockquote { blocks } => {
                    blocks.push(block);
                    return;
                }
                Frame::Item { children, .. } => {
                    children.push(block);
                    return;
                }
                _ => {}
            }
        }
    }

    for event in parser {
        match event {
            Event::Start(tag) => match tag {
                Tag::Paragraph => stack.push(Frame::Paragraph {
                    spans: Vec::new(),
                    style: InlineStyle::default(),
                }),
                Tag::Heading { level, .. } => stack.push(Frame::Heading {
                    level: heading_int(level),
                    spans: Vec::new(),
                    style: InlineStyle::default(),
                }),
                Tag::BlockQuote(_) => stack.push(Frame::Blockquote { blocks: Vec::new() }),
                Tag::CodeBlock(kind) => {
                    let language = match kind {
                        CodeBlockKind::Fenced(s) => s.to_string(),
                        CodeBlockKind::Indented => String::new(),
                    };
                    stack.push(Frame::CodeBlock {
                        language,
                        text: String::new(),
                    });
                }
                Tag::List(start) => stack.push(Frame::List {
                    ordered: start.is_some(),
                    start,
                    items: Vec::new(),
                }),
                Tag::Item => stack.push(Frame::Item {
                    spans: Vec::new(),
                    children: Vec::new(),
                    style: InlineStyle::default(),
                    checked: None,
                }),
                Tag::Emphasis => modify_style(&mut stack, |s| s.italic = true),
                Tag::Strong => modify_style(&mut stack, |s| s.bold = true),
                Tag::Strikethrough => modify_style(&mut stack, |s| s.strike = true),
                Tag::Link { dest_url, title, .. } => modify_style(&mut stack, |s| {
                    s.link_href = Some(dest_url.to_string());
                    if !title.is_empty() {
                        s.link_title = Some(title.to_string());
                    }
                }),
                Tag::Image { dest_url, title, .. } => {
                    // Render images as a link span tagged with the URL — the
                    // renderer can decide whether to render an <img> or a link.
                    // Wrapping in a synthetic link keeps the data model simple.
                    let style = current_style(&stack);
                    push_text_to_active(&mut stack, &format!("![{}]({})", title.as_ref(), dest_url));
                    let _ = style; // suppress unused warning; we keep style logic readable
                }
                Tag::Table(_) => stack.push(Frame::Table {
                    header: Vec::new(),
                    rows: Vec::new(),
                    in_header: false,
                    current_row: Vec::new(),
                    current_cell: Vec::new(),
                    style: InlineStyle::default(),
                }),
                Tag::TableHead => {
                    if let Some(Frame::Table { in_header, .. }) = stack.last_mut() {
                        *in_header = true;
                    }
                }
                Tag::TableRow => {}
                Tag::TableCell => {
                    if let Some(Frame::Table { current_cell, .. }) = stack.last_mut() {
                        current_cell.clear();
                    }
                }
                Tag::FootnoteDefinition(_) => {
                    // Treat footnote bodies as regular paragraphs for now.
                    stack.push(Frame::Paragraph {
                        spans: Vec::new(),
                        style: InlineStyle::default(),
                    });
                }
                Tag::DefinitionList | Tag::DefinitionListTitle | Tag::DefinitionListDefinition => {
                    // Definition lists are uncommon in chat output; drop into
                    // the closest paragraph-like container.
                }
                Tag::HtmlBlock => {
                    stack.push(Frame::CodeBlock {
                        language: "html".to_string(),
                        text: String::new(),
                    });
                }
                Tag::MetadataBlock(_) => {
                    // Frontmatter — skip for now; we don't render it.
                    stack.push(Frame::CodeBlock {
                        language: "yaml".to_string(),
                        text: String::new(),
                    });
                }
            },

            Event::End(tag_end) => match tag_end {
                TagEnd::Paragraph => {
                    if let Some(Frame::Paragraph { spans, .. }) = stack.pop() {
                        finish_block(&mut stack, MarkdownBlock::Paragraph { spans });
                    }
                }
                TagEnd::Heading(_) => {
                    if let Some(Frame::Heading { level, spans, .. }) = stack.pop() {
                        finish_block(&mut stack, MarkdownBlock::Heading { level, spans });
                    }
                }
                TagEnd::BlockQuote(_) => {
                    if let Some(Frame::Blockquote { blocks }) = stack.pop() {
                        finish_block(&mut stack, MarkdownBlock::Blockquote { children: blocks });
                    }
                }
                TagEnd::CodeBlock => {
                    if let Some(Frame::CodeBlock { language, text }) = stack.pop() {
                        let trimmed_text = text.trim_end_matches('\n').to_string();
                        finish_block(&mut stack, classify_code_block(&language, &trimmed_text));
                    }
                }
                TagEnd::List(_) => {
                    if let Some(Frame::List { ordered, start, items }) = stack.pop() {
                        finish_block(
                            &mut stack,
                            MarkdownBlock::List { ordered, start, items },
                        );
                    }
                }
                TagEnd::Item => {
                    if let Some(Frame::Item { spans, children, checked, .. }) = stack.pop() {
                        if let Some(Frame::List { items, .. }) = stack.last_mut() {
                            items.push(ListItem { spans, checked, children });
                        }
                    }
                }
                TagEnd::Emphasis => modify_style(&mut stack, |s| s.italic = false),
                TagEnd::Strong => modify_style(&mut stack, |s| s.bold = false),
                TagEnd::Strikethrough => modify_style(&mut stack, |s| s.strike = false),
                TagEnd::Link => modify_style(&mut stack, |s| {
                    s.link_href = None;
                    s.link_title = None;
                }),
                TagEnd::Image => {}
                TagEnd::Table => {
                    if let Some(Frame::Table { header, rows, .. }) = stack.pop() {
                        finish_block(&mut stack, MarkdownBlock::Table { header, rows });
                    }
                }
                TagEnd::TableHead => {
                    if let Some(Frame::Table { in_header, header, current_row, .. }) = stack.last_mut() {
                        *in_header = false;
                        if !current_row.is_empty() {
                            *header = std::mem::take(current_row);
                        }
                    }
                }
                TagEnd::TableRow => {
                    if let Some(Frame::Table { in_header, header, rows, current_row, .. }) = stack.last_mut() {
                        if *in_header {
                            *header = std::mem::take(current_row);
                        } else {
                            rows.push(TableRow {
                                cells: std::mem::take(current_row),
                            });
                        }
                    }
                }
                TagEnd::TableCell => {
                    if let Some(Frame::Table { current_row, current_cell, .. }) = stack.last_mut() {
                        current_row.push(std::mem::take(current_cell));
                    }
                }
                TagEnd::FootnoteDefinition => {
                    if let Some(Frame::Paragraph { spans, .. }) = stack.pop() {
                        finish_block(&mut stack, MarkdownBlock::Paragraph { spans });
                    }
                }
                TagEnd::HtmlBlock => {
                    if let Some(Frame::CodeBlock { text, .. }) = stack.pop() {
                        finish_block(&mut stack, MarkdownBlock::Html { text });
                    }
                }
                TagEnd::MetadataBlock(_) => {
                    if let Some(Frame::CodeBlock { .. }) = stack.pop() {
                        // Drop frontmatter silently — we don't render it.
                    }
                }
                _ => {}
            },

            Event::Text(text) => push_text_to_active(&mut stack, &text),
            Event::Code(text) => {
                let mut style = current_style(&stack);
                style.code = true;
                for frame in stack.iter_mut().rev() {
                    match frame {
                        Frame::Paragraph { spans, .. }
                        | Frame::Heading { spans, .. }
                        | Frame::Item { spans, .. } => {
                            push_inline(spans, &style, &text);
                            break;
                        }
                        Frame::Table { current_cell, .. } => {
                            push_inline(current_cell, &style, &text);
                            break;
                        }
                        _ => {}
                    }
                }
            }
            Event::SoftBreak => push_text_to_active(&mut stack, " "),
            Event::HardBreak => push_text_to_active(&mut stack, "\n"),
            Event::Rule => finish_block(&mut stack, MarkdownBlock::HorizontalRule),
            Event::TaskListMarker(checked) => {
                if let Some(Frame::Item { checked: c, .. }) = stack.last_mut() {
                    *c = Some(checked);
                }
            }
            Event::Html(text) | Event::InlineHtml(text) => {
                // Inline HTML inside a paragraph — surface as plain text.
                push_text_to_active(&mut stack, &text);
            }
            Event::FootnoteReference(_) => {}
            Event::DisplayMath(text) | Event::InlineMath(text) => {
                push_text_to_active(&mut stack, &text);
            }
        }
    }

    let mut blocks = match stack.pop() {
        Some(Frame::Document { blocks }) => blocks,
        _ => Vec::new(),
    };

    // Append any pulled-out kiro_summary blocks at the end (they originally
    // appeared at the bottom of the message). If you'd prefer to keep position
    // fidelity, splice them at their extracted offsets — left as future work.
    for json in summaries {
        blocks.push(MarkdownBlock::KiroSummary { json });
    }

    ParsedMarkdown { blocks }
}

#[tauri::command]
pub fn parse_markdown(text: String) -> ParsedMarkdown {
    parse(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn first_block(input: &str) -> MarkdownBlock {
        parse(input).blocks.into_iter().next().expect("expected at least one block")
    }

    #[test]
    fn parses_paragraph() {
        match first_block("hello world") {
            MarkdownBlock::Paragraph { spans } => {
                assert_eq!(spans.len(), 1);
                assert_eq!(spans[0].text, "hello world");
            }
            _ => panic!("expected paragraph"),
        }
    }

    #[test]
    fn parses_heading_with_emphasis() {
        match first_block("# Hello *world*") {
            MarkdownBlock::Heading { level, spans } => {
                assert_eq!(level, 1);
                let italic_span = spans.iter().find(|s| s.style.italic);
                assert!(italic_span.is_some(), "expected an italic span");
                assert_eq!(italic_span.unwrap().text, "world");
            }
            _ => panic!("expected heading"),
        }
    }

    #[test]
    fn parses_fenced_code_block() {
        let input = "```rust\nfn main() {}\n```";
        match first_block(input) {
            MarkdownBlock::CodeBlock { language, text } => {
                assert_eq!(language, "rust");
                assert_eq!(text, "fn main() {}");
            }
            _ => panic!("expected code block"),
        }
    }

    #[test]
    fn recognizes_mermaid() {
        let input = "```mermaid\ngraph TD;\nA-->B;\n```";
        match first_block(input) {
            MarkdownBlock::Mermaid { text } => {
                assert!(text.contains("graph TD"));
            }
            _ => panic!("expected mermaid block"),
        }
    }

    #[test]
    fn extracts_kiro_summary() {
        let input = "Here is the summary.\n<kiro_summary>{\"ok\":true}</kiro_summary>\n";
        let parsed = parse(input);
        let summary = parsed.blocks.iter().find_map(|b| match b {
            MarkdownBlock::KiroSummary { json } => Some(json.clone()),
            _ => None,
        });
        assert_eq!(summary.as_deref(), Some("{\"ok\":true}"));
        // The visible text should still contain the summary's leading sentence.
        let has_para = parsed.blocks.iter().any(|b| matches!(b, MarkdownBlock::Paragraph { .. }));
        assert!(has_para);
    }

    #[test]
    fn parses_unordered_list_with_tasks() {
        let input = "- [ ] todo\n- [x] done\n";
        match first_block(input) {
            MarkdownBlock::List { ordered, items, .. } => {
                assert!(!ordered);
                assert_eq!(items.len(), 2);
                assert_eq!(items[0].checked, Some(false));
                assert_eq!(items[1].checked, Some(true));
            }
            _ => panic!("expected list"),
        }
    }

    #[test]
    fn parses_table() {
        let input = "| a | b |\n|---|---|\n| 1 | 2 |\n";
        match first_block(input) {
            MarkdownBlock::Table { header, rows } => {
                assert_eq!(header.len(), 2);
                assert_eq!(rows.len(), 1);
                assert_eq!(rows[0].cells.len(), 2);
            }
            _ => panic!("expected table"),
        }
    }

    #[test]
    fn link_style_applied() {
        let input = "see [docs](https://example.com)";
        match first_block(input) {
            MarkdownBlock::Paragraph { spans } => {
                let link_span = spans.iter().find(|s| s.style.link_href.is_some());
                let link = link_span.expect("expected a link span");
                assert_eq!(link.text, "docs");
                assert_eq!(link.style.link_href.as_deref(), Some("https://example.com"));
            }
            _ => panic!("expected paragraph"),
        }
    }

    #[test]
    fn extract_kiro_summaries_handles_missing_close() {
        let (out, summaries) = extract_kiro_summaries("hello <kiro_summary>{ no end");
        assert_eq!(out, "hello <kiro_summary>{ no end");
        assert!(summaries.is_empty());
    }

    #[test]
    fn handles_empty_input() {
        let parsed = parse("");
        assert!(parsed.blocks.is_empty());
    }
}
