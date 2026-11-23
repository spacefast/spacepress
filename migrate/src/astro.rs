use crate::config::{Entry, Failure, entry, fail};
use crate::project;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use spacepress::{astro_content, diag, loader::Disk, sync::front_matter};

const USAGE: &str = "usage: spacepress-migrate --from astro app <project> --out <new-dir> [--dry-run]";
const CONFIG: &str = "import { defineConfig } from \"spacepress\";\nexport default defineConfig({});\n";

#[derive(Serialize)]
struct Report {
    version: u32,
    source: &'static str,
    status: &'static str,
    entries: Vec<Entry>,
    errors: Vec<Failure>,
}

pub fn cli(args: &[String]) -> ExitCode {
    let (input, output, dry_run) = match args {
        [input, flag, output] if flag == "--out" => (input, output, false),
        [input, flag, output, dry_run] if flag == "--out" && dry_run == "--dry-run" => (input, output, true),
        _ => {
            eprintln!("{USAGE}");
            return ExitCode::from(2);
        }
    };
    let root = Path::new(input);
    let out = Path::new(output);
    let mut report = Report {
        version: 1,
        source: "astro",
        status: "refused",
        entries: Vec::new(),
        errors: Vec::new(),
    };
    let result = project::unused_output(out).and_then(|()| candidate(root, &mut report.entries));
    match result.and_then(|files| if dry_run { Ok(()) } else { project::write(out, &files) }) {
        Ok(()) => report.status = if dry_run { "dry-run" } else { "written" },
        Err(error) => report.errors.push(error),
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

fn candidate(root: &Path, entries: &mut Vec<Entry>) -> Result<BTreeMap<String, Vec<u8>>, Failure> {
    let root = root.canonicalize().map_err(|e| fail("", e.to_string()))?;
    if !root.is_dir() {
        return Err(fail("", "input must be an Astro project directory"));
    }
    let mut source = BTreeMap::from([(PathBuf::from("spacepress.config.ts"), CONFIG.to_owned())]);
    let mut assets = BTreeMap::new();
    if let Some((_, schema)) = astro_content::module(&Disk, &root)
        .map_err(|d| fail("/src/content.config.ts", diag::render(&d, &root)).spanned(d.span, &root))?
    {
        source.insert(PathBuf::from("sp/schema.ts"), schema);
        entries.push(entry(
            "/src/content.config.ts",
            "mapped",
            "collection schemas become sp/schema.ts",
        ));
    }
    for dirname in ["src/pages", "src/layouts", "src/components", "src/content", "public"] {
        for relative in files_under(&root, Path::new(dirname))? {
            let file = relative.to_str().ok_or_else(|| fail("", "file paths must be UTF-8"))?;
            let at = format!("/{file}");
            let read = |error: std::io::Error| fail(&at, error.to_string());
            match dirname {
                "public" | "src/content" => {
                    assets.insert(file.to_owned(), fs::read(root.join(&relative)).map_err(read)?);
                    entries.push(entry(&at, "copied", "copied at its original path"));
                }
                "src/pages" if relative.extension().is_some_and(|ext| ext == "md") && !file.contains(['[', ']']) => {
                    let text = fs::read_to_string(root.join(&relative)).map_err(read)?;
                    let page = markdown_page(&text, &at)?;
                    let route = relative.strip_prefix("src/pages").expect("page prefix");
                    let stem = route.file_stem().expect("Markdown file stem");
                    let mut destination = Path::new("sp/app").join(route.parent().expect("page parent"));
                    if stem != "index" {
                        destination.push(stem);
                    }
                    destination.push("page.md");
                    entries.push(entry(
                        &at,
                        "mapped",
                        format!("Markdown page becomes {}", destination.display()),
                    ));
                    if source.insert(destination, page).is_some() {
                        return Err(fail(&at, "two source files map to the same page"));
                    }
                }
                _ => entries.push(entry(
                    &at,
                    "review",
                    "port this source file to a SpacePress route, layout or component",
                )),
            }
        }
    }
    for config in ["astro.config.mjs", "astro.config.ts", "astro.config.js"] {
        if root.join(config).is_file() {
            entries.push(entry(
                &format!("/{config}"),
                "review",
                "review integrations and site settings before publishing",
            ));
        }
    }
    project::check(&source)?;
    assets.extend(source.into_iter().map(|(path, text)| {
        (
            path.into_os_string().into_string().expect("UTF-8 candidate path"),
            text.into_bytes(),
        )
    }));
    Ok(assets)
}

fn files_under(root: &Path, relative: &Path) -> Result<Vec<PathBuf>, Failure> {
    let path = root.join(relative);
    let at = relative.to_string_lossy();
    let report = |e: std::io::Error| fail(&format!("/{at}"), e.to_string());
    let kind = match path.symlink_metadata() {
        Ok(meta) => meta.file_type(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(report(e)),
    };
    if kind.is_file() {
        return Ok(vec![relative.to_owned()]);
    }
    if !kind.is_dir() {
        return Err(fail(&format!("/{at}"), "copy requires a regular file or directory"));
    }
    let children = fs::read_dir(&path)
        .map_err(report)?
        .map(|entry| entry.map(|entry| relative.join(entry.file_name())).map_err(report))
        .collect::<Result<Vec<_>, _>>()?;
    let mut files = Vec::new();
    for child in children {
        files.extend(files_under(root, &child)?);
    }
    files.sort();
    Ok(files)
}

fn markdown_page(text: &str, at: &str) -> Result<String, Failure> {
    let text = text.replace("\r\n", "\n");
    if !text.starts_with("---\n") {
        return Ok(text);
    }
    let document = front_matter::parse_document(&text)
        .map_err(|error| fail(at, format!("line {}: {}", error.line, error.message)))?;
    let mut page = String::from("---\n");
    for (name, value) in document.front {
        match name.as_str() {
            "layout" => {}
            "draft" if value == Value::Bool(true) => page.push_str("status: draft\n"),
            "draft" if value == Value::Bool(false) => {}
            "title" | "description" => {
                page.push_str(&format!("{name}: {value}\n"));
            }
            _ => {
                return Err(fail(
                    at,
                    format!("review Markdown front matter key {name:?} before converting"),
                ));
            }
        }
    }
    page.push_str("---\n");
    page.push_str(&document.body);
    Ok(page)
}
