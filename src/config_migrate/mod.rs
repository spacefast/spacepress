//! One-time config import. This module never runs source CMS code or imports data.
pub(crate) mod app;
mod input;
mod translate;

use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

#[derive(Clone, Copy)]
pub(super) enum Source {
    Emdash,
    Payload,
    Sanity,
    Zero,
}

impl Source {
    fn parse(s: &str) -> Option<Self> {
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
pub(super) struct Failure {
    pointer: String,
    reason: String,
}

pub(super) fn fail(at: &str, reason: impl Into<String>) -> Failure {
    Failure {
        pointer: at.into(),
        reason: reason.into(),
    }
}

pub(super) fn pointer(parent: &str, key: &str) -> String {
    format!("{parent}/{}", key.replace('~', "~0").replace('/', "~1"))
}

#[derive(Serialize)]
pub(super) struct Entry {
    pointer: String,
    outcome: &'static str,
    reason: String,
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

const USAGE: &str =
    "usage: zero migrate config --from emdash|payload|sanity|zero <input.ts|input.json> --out <new/zero.config.ts>";

struct Args {
    source: Source,
    name: String,
    input: PathBuf,
    out: PathBuf,
}

fn args() -> Result<Args, String> {
    let mut it = std::env::args().skip(2);
    if it.next().as_deref() != Some("config") {
        return Err(USAGE.into());
    }
    let mut source = None;
    let mut input = None;
    let mut out = None;
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--from" if source.is_none() => source = Some(it.next().ok_or("--from requires a source CMS")?),
            "--out" if out.is_none() => out = Some(PathBuf::from(it.next().ok_or("--out requires a new config path")?)),
            flag if flag.starts_with('-') => return Err(format!("unknown or repeated flag {flag}\n{USAGE}")),
            _ if input.is_none() => input = Some(PathBuf::from(arg)),
            _ => return Err(USAGE.into()),
        }
    }
    let name = source.ok_or(USAGE)?;
    Ok(Args {
        source: Source::parse(&name).ok_or(format!("unknown source {name}\n{USAGE}"))?,
        name,
        input: input.ok_or(USAGE)?,
        out: out.ok_or(USAGE)?,
    })
}

pub fn cli() -> ExitCode {
    let args = match args() {
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
        Ok(()) => report.status = "written",
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
    let input = input::read(&args.input, args.source)?;
    let config = translate::config(input, args.source, entries)?;
    // Validate the emitted config through the same compiler as `zero build`.
    let check = tempfile::tempdir().map_err(|e| fail("", e.to_string()))?;
    std::fs::write(check.path().join("zero.config.ts"), &config).map_err(|e| fail("", e.to_string()))?;
    crate::commands::validate_config(check.path()).map_err(|d| {
        fail(
            "",
            format!(
                "generated config cannot compile: {}",
                crate::diag::render(&d, check.path())
            ),
        )
    })?;
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
