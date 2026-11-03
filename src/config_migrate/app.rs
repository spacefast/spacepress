//! A one-time source transformation. No legacy runtime is installed in the target.
mod transform;

use super::{Entry, Failure, fail};
use crate::{diag, loader, pipeline};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

#[derive(Serialize)]
struct Report {
    version: u32,
    source: &'static str,
    status: &'static str,
    entries: Vec<Entry>,
    errors: Vec<Failure>,
    adoption_sql: Option<String>,
    connector_roles: serde_json::Value,
}

const USAGE: &str =
    "usage: zero migrate app --from zero-0.8 <capsule-dir> --out <new-dir> [--space <space-id>] [--dry-run] [--json]";

struct Args {
    input: PathBuf,
    out: PathBuf,
    space: Option<String>,
    dry_run: bool,
}

fn args(raw: &[String]) -> Result<Args, String> {
    let mut from = None;
    let mut input = None;
    let mut out = None;
    let mut space = None;
    let mut dry_run = false;
    let mut json = false;
    let mut it = raw.iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--from" if from.is_none() => from = Some(it.next().ok_or(USAGE)?.as_str()),
            "--out" if out.is_none() => out = Some(PathBuf::from(it.next().ok_or(USAGE)?)),
            "--space" if space.is_none() => space = Some(it.next().ok_or(USAGE)?.clone()),
            "--dry-run" if !dry_run => dry_run = true,
            "--json" if !json => json = true,
            s if s.starts_with('-') => return Err(format!("unknown or repeated flag {s}\n{USAGE}")),
            _ if input.is_none() => input = Some(PathBuf::from(arg)),
            _ => return Err(USAGE.into()),
        }
    }
    if from != Some("zero-0.8") {
        return Err(USAGE.into());
    }
    Ok(Args {
        input: input.ok_or(USAGE)?,
        out: out.ok_or(USAGE)?,
        space,
        dry_run,
    })
}

pub(crate) fn cli(raw: &[String]) -> ExitCode {
    let args = match args(raw) {
        Ok(args) => args,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::from(2);
        }
    };
    let mut report = Report {
        version: 1,
        source: "zero-0.8",
        status: "refused",
        entries: vec![],
        errors: vec![],
        adoption_sql: None,
        connector_roles: serde_json::json!({}),
    };
    if let Err(e) = run(&args, &mut report) {
        report.errors.push(e);
    }
    println!("{}", serde_json::to_string_pretty(&report).expect("report JSON"));
    if report.errors.is_empty() {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}

fn io(e: std::io::Error) -> Failure {
    fail("", e.to_string())
}

fn run(args: &Args, report: &mut Report) -> Result<(), Failure> {
    if std::fs::symlink_metadata(&args.out).is_ok() {
        return Err(fail(
            "",
            "output already exists; choose a new directory; no files are overwritten",
        ));
    }
    let root = std::fs::canonicalize(&args.input).map_err(io)?;
    let entry = PathBuf::from("server/index.ts");
    let mut sources = BTreeMap::new();
    collect_sources(&root, &entry, &mut sources, &mut BTreeSet::new())?;
    for dir in ["pages", "islands", "layouts"] {
        if root.join(dir).exists() {
            refuse_pages(&root.join(dir), &format!("/{dir}"), &mut report.errors)?;
        }
    }
    let transformed = transform::app(
        &entry,
        sources
            .get(&entry)
            .ok_or_else(|| fail("", "entry source must resolve to server/index.ts inside the capsule"))?,
        args.space.as_deref(),
        &mut report.entries,
        &mut report.errors,
    )?;
    report.connector_roles = transformed.connector_roles;
    if sources.contains_key(Path::new("zero.config.ts")) || sources.contains_key(Path::new("server/__z08-content.ts")) {
        return Err(fail("", "input imports a reserved generated config path"));
    }
    sources.insert(entry, transformed.config);
    if let Some(content) = transformed.content_config {
        sources.insert(PathBuf::from("server/__z08-content.ts"), content);
    }
    sources.insert(
        PathBuf::from("zero.config.ts"),
        "export { default } from \"./server/index\";\n".into(),
    );
    // Both dry runs and writes compile the same candidate, before creating a destination.
    if !report.errors.is_empty() {
        return Ok(());
    }
    let stage = tempfile::tempdir().map_err(io)?;
    for (path, source) in &sources {
        let target = stage.path().join(path);
        std::fs::create_dir_all(target.parent().expect("file parent")).map_err(io)?;
        std::fs::write(target, source).map_err(io)?;
    }
    let checked_root = std::fs::canonicalize(stage.path()).map_err(io)?;
    let program =
        loader::load(&checked_root.join("zero.config.ts")).map_err(|d| fail("", diag::render(&d, &checked_root)))?;
    let built = pipeline::build(&checked_root, &program, || Ok(pipeline::Previous::none()), |_| None).map_err(|d| {
        fail(
            "",
            format!(
                "generated application refused by v2 compiler: {}",
                diag::render(&d, &checked_root)
            ),
        )
    })?;
    let sql = built
        .migrations
        .iter()
        .map(|(_, sql)| sql.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    report.adoption_sql = Some(sql.clone());
    if args.dry_run {
        report.status = "dry-run";
        return Ok(());
    }
    let migrations = stage.path().join("zero/migrations");
    std::fs::create_dir_all(&migrations).map_err(io)?;
    std::fs::write(migrations.join("0001_adopt.sql"), sql).map_err(io)?;
    std::fs::write(
        migrations.join("snapshot.json"),
        serde_json::to_string_pretty(&built.snapshot).expect("snapshot JSON"),
    )
    .map_err(io)?;
    if report
        .connector_roles
        .as_object()
        .is_some_and(|roles| !roles.is_empty())
    {
        std::fs::write(
            stage.path().join("connector-roles.json"),
            serde_json::to_string_pretty(&report.connector_roles).expect("roles JSON"),
        )
        .map_err(io)?;
    }
    // Publish with create_new per file in a newly owned directory. Never rename over another app.
    let parent = args
        .out
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    std::fs::create_dir_all(parent).map_err(io)?;
    std::fs::create_dir(&args.out).map_err(io)?;
    let result = copy_new(stage.path(), &args.out);
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&args.out);
    }
    result?;
    report.status = "written";
    Ok(())
}

fn copy_new(from: &Path, to: &Path) -> Result<(), Failure> {
    use std::io::Write;
    for entry in std::fs::read_dir(from).map_err(io)? {
        let entry = entry.map_err(io)?;
        let target = to.join(entry.file_name());
        if entry.file_type().map_err(io)?.is_dir() {
            std::fs::create_dir(&target).map_err(io)?;
            copy_new(&entry.path(), &target)?;
        } else {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(target)
                .map_err(io)?;
            file.write_all(&std::fs::read(entry.path()).map_err(io)?).map_err(io)?;
        }
    }
    Ok(())
}

fn collect_sources(
    root: &Path,
    path: &Path,
    out: &mut BTreeMap<PathBuf, String>,
    seen: &mut BTreeSet<PathBuf>,
) -> Result<(), Failure> {
    let absolute = std::fs::canonicalize(root.join(path)).map_err(|e| {
        fail(
            "",
            format!(
                "cannot read capsule source {}: {e}; compiled finalize payloads are not capsule source",
                path.display()
            ),
        )
    })?;
    if !absolute.starts_with(root) {
        return Err(fail("", "source import escapes the capsule directory"));
    }
    let relative = absolute.strip_prefix(root).expect("inside root").to_path_buf();
    if !seen.insert(relative.clone()) {
        return Ok(());
    }
    let source = std::fs::read_to_string(&absolute).map_err(io)?;
    let body = transform::parse(&relative, &source)?;
    for import in transform::imports(&body) {
        if import.starts_with('.') {
            let base = relative.parent().expect("source parent").join(import);
            let target = if root.join(&base).is_file() {
                base
            } else {
                base.with_extension("ts")
            };
            collect_sources(root, &target, out, seen)?;
        } else if import != "@spacefast/zero/server" {
            return Err(fail(
                "",
                format!("package {import:?} needs a manual port; only local TypeScript helpers are copied"),
            ));
        }
    }
    out.insert(relative, source);
    Ok(())
}

fn refuse_pages(path: &Path, at: &str, errors: &mut Vec<Failure>) -> Result<(), Failure> {
    if !std::fs::symlink_metadata(path).map_err(io)?.file_type().is_dir() {
        errors.push(fail(at, "page, layout and island compilation needs an explicit port"));
        return Ok(());
    }
    let mut entries = std::fs::read_dir(path)
        .map_err(io)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(io)?;
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let at = super::pointer(at, &entry.file_name().to_string_lossy());
        if entry.file_type().map_err(io)?.is_dir() {
            refuse_pages(&entry.path(), &at, errors)?;
        } else {
            errors.push(fail(&at, "page, layout and island compilation needs an explicit port"));
        }
    }
    Ok(())
}
