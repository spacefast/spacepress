//! One-time config import. This module never runs source CMS code or imports data.
#[path = "zero/input.rs"]
pub(crate) mod input;
#[path = "zero/translate.rs"]
pub(crate) mod translate;
use crate::zero;

use serde::Serialize;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Clone, Copy)]
pub enum Source {
    Emdash,
    Payload,
    Sanity,
    Zero,
}

impl Source {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "emdash" => Self::Emdash,
            "payload" => Self::Payload,
            "sanity" => Self::Sanity,
            "zero" => Self::Zero,
            _ => return None,
        })
    }
}

#[derive(Debug, Serialize)]
pub struct Failure {
    pub(crate) pointer: String,
    pub(crate) reason: String,
    /// `typedpress migrate app` adds the diagnostic contract (`zero::codes`) before it reports.
    #[serde(flatten)]
    pub(crate) contract: Option<Box<zero::codes::Contract>>,
    /// Where in the 0.8 source the refusal is: capsule-relative file, 1-based line and UTF-16 column.
    #[serde(skip)]
    pub(crate) location: Option<Box<(String, usize, usize)>>,
}

pub(super) fn fail(at: &str, reason: impl Into<String>) -> Failure {
    Failure {
        pointer: at.into(),
        reason: reason.into(),
        contract: None,
        location: None,
    }
}

impl Failure {
    /// The capsule file a page, layout or client pointer names (`/pages/a.tsx` → `pages/a.tsx`).
    pub(super) fn pointer_file(&self) -> String {
        self.pointer
            .trim_start_matches('/')
            .replace("~1", "/")
            .replace("~0", "~")
    }

    /// Locates the refusal at a capsule-relative file, 1-based line and UTF-16 column.
    pub(super) fn located(mut self, file: String, line: usize, column: usize) -> Failure {
        self.location = Some(Box::new((file, line, column)));
        self
    }

    /// Locates the refusal at `span` unless something more precise already did.
    pub(super) fn spanned(mut self, span: typedpress::diag::Span, root: &Path) -> Failure {
        if self.location.is_none() {
            self.location = typedpress::diag::position(span, root).map(Box::new);
        }
        self
    }
}

pub(super) fn pointer(parent: &str, key: &str) -> String {
    format!("{parent}/{}", key.replace('~', "~0").replace('/', "~1"))
}

#[derive(Serialize)]
pub struct Entry {
    pub(crate) pointer: String,
    outcome: &'static str,
    pub(crate) reason: String,
}

pub(super) fn entry(at: &str, outcome: &'static str, reason: impl Into<String>) -> Entry {
    Entry {
        pointer: at.into(),
        outcome,
        reason: reason.into(),
    }
}

#[derive(Serialize)]
struct Report<'a> {
    version: u32,
    source: &'a str,
    status: &'static str,
    entries: Vec<Entry>,
    errors: Vec<Failure>,
}

const USAGE: &str = "usage: typedpress-migrate --from emdash|payload|sanity|zero config <input.ts|input.json> --out <new/typedpress.config.ts> [--dry-run]";

struct Args {
    source: Source,
    name: String,
    input: PathBuf,
    out: PathBuf,
    dry_run: bool,
}

fn args(source: &str, raw: &[String]) -> Result<Args, String> {
    let mut it = raw.iter().cloned();
    let mut input = None;
    let mut out = None;
    let mut dry_run = false;
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--dry-run" if !dry_run => dry_run = true,
            "--out" if out.is_none() => out = Some(PathBuf::from(it.next().ok_or("--out requires a new config path")?)),
            flag if flag.starts_with('-') => return Err(format!("unknown or repeated flag {flag}\n{USAGE}")),
            _ if input.is_none() => input = Some(PathBuf::from(arg)),
            _ => return Err(USAGE.into()),
        }
    }
    let name = source.to_owned();
    Ok(Args {
        source: Source::parse(&name).ok_or(format!("unknown source {name}\n{USAGE}"))?,
        name,
        input: input.ok_or(USAGE)?,
        out: out.ok_or(USAGE)?,
        dry_run,
    })
}

pub fn cli(source: &str, raw: &[String]) -> ExitCode {
    let args = match args(source, raw) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::from(2);
        }
    };
    let mut report = Report {
        version: 1,
        source: &args.name,
        status: "refused",
        entries: Vec::new(),
        errors: Vec::new(),
    };
    let result = run(&args, &mut report.entries);
    match result {
        Ok(()) => report.status = if args.dry_run { "dry-run" } else { "written" },
        Err(e) => report.errors.push(e),
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&report).expect("serializable report")
    );
    if report.errors.is_empty() {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}

fn run(args: &Args, entries: &mut Vec<Entry>) -> Result<(), Failure> {
    if args.out.try_exists().map_err(|e| fail("", e.to_string()))? || std::fs::symlink_metadata(&args.out).is_ok() {
        return Err(fail(
            "",
            "output already exists; choose a new path (original files are never overwritten)",
        ));
    }
    let text = std::fs::read_to_string(&args.input).map_err(|e| fail("", format!("cannot read input: {e}")))?;
    let config = convert(args.source, &args.input, &text, entries)?;
    if args.dry_run {
        return Ok(());
    }
    let parent = args
        .out
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    std::fs::create_dir_all(parent).map_err(|e| fail("", e.to_string()))?;
    let mut staged = tempfile::NamedTempFile::new_in(parent).map_err(|e| fail("", e.to_string()))?;
    staged
        .write_all(config.as_bytes())
        .map_err(|e| fail("", e.to_string()))?;
    staged
        .persist_noclobber(&args.out)
        .map_err(|e| fail("", format!("cannot publish config without overwriting: {e}")))?;
    Ok(())
}

/// Translate declarations and compile the candidate entirely in memory.
pub fn convert(source: Source, path: &Path, text: &str, entries: &mut Vec<Entry>) -> Result<String, Failure> {
    let input = input::parse(path, text, source)?;
    let config = translate::config(input, source, entries)?;
    let response = typedpress::wasm::compile(
        &serde_json::json!({"name":"candidate", "files":{"typedpress.config.ts":config}}).to_string(),
    );
    let checked: serde_json::Value = serde_json::from_str(&response).expect("compiler response");
    if checked["output"].is_null() {
        return Err(fail(
            "",
            format!("generated config cannot compile: {}", checked["check"]),
        ));
    }
    Ok(config)
}
