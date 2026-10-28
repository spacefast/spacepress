//! Build diagnostics: every rule the compiler enforces fails with a file, a
//! line, a column, and a reason. Nothing is silently ignored.

use std::cell::RefCell;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

/// Byte range inside one source file. `file == NO_FILE` marks synthetic spans.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
pub struct Span {
    pub file: u32,
    pub start: u32,
    pub end: u32,
}

pub const NO_FILE: u32 = u32::MAX;

impl Span {
    pub const NONE: Span = Span { file: NO_FILE, start: 0, end: 0 };
}

#[derive(Debug, Clone)]
pub struct Diag {
    pub span: Span,
    pub message: String,
    pub help: Option<String>,
}

impl Diag {
    pub fn new(span: Span, message: impl Into<String>) -> Self {
        Diag { span, message: message.into(), help: None }
    }

    pub fn help(mut self, help: impl Into<String>) -> Self {
        self.help = Some(help.into());
        self
    }
}

pub type Result<T> = std::result::Result<T, Diag>;

thread_local! {
    static FILES: RefCell<Vec<(PathBuf, String)>> = const { RefCell::new(Vec::new()) };
}

/// Registers a source file so spans can be rendered later. Returns its id.
pub fn register_file(path: &Path, source: &str) -> u32 {
    FILES.with(|files| {
        let mut files = files.borrow_mut();
        files.push((path.to_path_buf(), source.to_string()));
        (files.len() - 1) as u32
    })
}

pub fn file_path(id: u32) -> Option<PathBuf> {
    FILES.with(|files| files.borrow().get(id as usize).map(|(p, _)| p.clone()))
}

pub fn source_slice(span: Span) -> Option<String> {
    FILES.with(|files| {
        let files = files.borrow();
        let (_, src) = files.get(span.file as usize)?;
        src.get(span.start as usize..span.end as usize).map(str::to_string)
    })
}

/// `path:line:col` for a span, relative to `root` when possible.
pub fn location(span: Span, root: &Path) -> String {
    FILES.with(|files| {
        let files = files.borrow();
        let Some((path, src)) = files.get(span.file as usize) else {
            return "<zero>".to_string();
        };
        let (line, col) = line_col(src, span.start as usize);
        let shown = path.strip_prefix(root).unwrap_or(path);
        format!("{}:{}:{}", shown.display(), line, col)
    })
}

fn line_col(src: &str, offset: usize) -> (usize, usize) {
    let offset = offset.min(src.len());
    let before = &src[..offset];
    let line = before.matches('\n').count() + 1;
    let line_start = before.rfind('\n').map_or(0, |i| i + 1);
    let col = src[line_start..offset].chars().count() + 1;
    (line, col)
}

/// Renders a diagnostic with a code frame, rustc-style.
pub fn render(diag: &Diag, root: &Path) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "error: {}", diag.message);
    FILES.with(|files| {
        let files = files.borrow();
        if let Some((path, src)) = files.get(diag.span.file as usize) {
            let start = (diag.span.start as usize).min(src.len());
            let (line, col) = line_col(src, start);
            let shown = path.strip_prefix(root).unwrap_or(path);
            let _ = writeln!(out, "  --> {}:{}:{}", shown.display(), line, col);
            let line_text = src.lines().nth(line - 1).unwrap_or("");
            let gutter = line.to_string().len();
            let end = (diag.span.end as usize).min(src.len()).max(start);
            let line_end = start + line_text.len().saturating_sub(col - 1);
            let width = src[start..end.min(line_end).max(start)].chars().count().max(1);
            let _ = writeln!(out, "{:gutter$} |", "");
            let _ = writeln!(out, "{line} | {line_text}");
            let _ = writeln!(out, "{:gutter$} | {}{}", "", " ".repeat(col - 1), "^".repeat(width));
        }
    });
    if let Some(help) = &diag.help {
        let _ = writeln!(out, "  = help: {help}");
    }
    out
}

/// Closest candidate by edit distance, for "did you mean" hints.
pub fn suggest<'a>(name: &str, candidates: impl IntoIterator<Item = &'a str>) -> Option<String> {
    let mut best: Option<(usize, &str)> = None;
    for candidate in candidates {
        let distance = edit_distance(&name.to_lowercase(), &candidate.to_lowercase());
        let limit = (name.len().max(candidate.len()) / 3).max(1);
        if distance <= limit && best.is_none_or(|(d, _)| distance < d) {
            best = Some((distance, candidate));
        }
    }
    best.map(|(_, c)| c.to_string())
}

fn edit_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut cur = vec![i; b.len() + 1];
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
        }
        prev = cur;
    }
    prev[b.len()]
}
