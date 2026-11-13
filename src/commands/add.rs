//! `first add <module> [dir]`: adds an optional part of First to a project as ordinary files the
//! author then owns. A module is a row in [`MODULES`]: its name, what it is, and the files it
//! writes. A new module (`pages`, `agents`) is one more row and its files under `add/<name>/`.
//!
//! The command only ever creates files. One that is already there is kept as it is, so running it
//! again adds whatever is missing and changes nothing else. The project is compiled in memory
//! before the first write and again after the last: a project that doesn't compile is left alone,
//! and files that would break one that did (an export name the app already uses) are taken out
//! again.

use crate::diag::{self, Diag};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

struct File {
    /// Relative to the project root, with `/` separators.
    path: &'static str,
    content: &'static str,
    what: &'static str,
}

struct Module {
    name: &'static str,
    summary: &'static str,
    files: &'static [File],
    /// What to run next, one line each.
    next: &'static [&'static str],
}

const MODULES: &[Module] = &[Module {
    name: "db",
    summary: "SQL tables beside your WordPress content: table(), foreign keys, a schema check at deploy",
    files: &[
        File {
            path: "first/tables.ts",
            content: include_str!("add/db/tables.ts"),
            what: "two example tables, with a foreign key and access rules",
        },
        File {
            path: "tables.client.ts",
            content: include_str!("add/db/tables.client.ts"),
            what: "typed client calls for them",
        },
        File {
            path: "first/DATABASE.md",
            content: include_str!("add/db/DATABASE.md"),
            what: "how tables, migrations and the deploy check work",
        },
    ],
    next: &[
        "first build   writes the SQL for the new tables to first/_generated/migrations/ (commit it)",
        "first dev     applies it to the local site",
    ],
}];

fn modules() -> String {
    let width = MODULES.iter().map(|m| m.name.len()).max().unwrap_or(0);
    let mut out = String::from("modules:\n");
    for module in MODULES {
        out.push_str(&format!("  {:width$}  {}\n", module.name, module.summary));
    }
    out
}

fn usage(message: &str) -> ExitCode {
    eprint!("{message}\nusage: first add <module> [dir]\n{}", modules());
    ExitCode::from(2)
}

/// Whether anything at all is at `path`: a file, a directory, or a link that points nowhere.
fn occupied(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok()
}

/// Creates `path` with `content`. Fails when something is already there, so a file that appeared
/// since [`occupied`] looked is never replaced.
fn create(path: &Path, content: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?
        .write_all(content.as_bytes())
}

fn refuse(project: &Path, problem: &Diag, message: &str) -> ExitCode {
    eprint!("{}", diag::render(problem, project));
    eprintln!("{message}");
    ExitCode::from(1)
}

pub(crate) fn cli(args: &[String]) -> ExitCode {
    if let Some(option) = args.iter().find(|a| a.starts_with('-')) {
        return usage(&format!("unknown option {option} for first add"));
    }
    let (name, dir) = match args {
        [name] => (name, "."),
        [name, dir] => (name, dir.as_str()),
        [] => return usage("first add needs a module"),
        _ => return usage("first add takes one module and one directory"),
    };
    let Some(module) = MODULES.iter().find(|m| m.name == name) else {
        return usage(&format!("no module {name}"));
    };
    let project = PathBuf::from(dir);
    let project = project.canonicalize().unwrap_or(project);
    let command = format!("first add {}", module.name);

    if let Err(problem) = super::build::compile(&project) {
        return refuse(
            &project,
            &problem,
            &format!("{command}: the project has to compile first. Nothing was added."),
        );
    }
    // Files and the directories made for them, in the order they were made.
    let mut created: Vec<&File> = Vec::new();
    let mut directories: Vec<PathBuf> = Vec::new();
    let undo = |created: &[&File], directories: &[PathBuf]| {
        for file in created {
            let _ = std::fs::remove_file(project.join(file.path));
        }
        for directory in directories.iter().rev() {
            let _ = std::fs::remove_dir(directory);
        }
    };
    for file in module.files {
        let path = project.join(file.path);
        if occupied(&path) {
            continue;
        }
        let missing: Vec<PathBuf> = path
            .ancestors()
            .skip(1)
            .take_while(|directory| !occupied(directory))
            .map(Path::to_path_buf)
            .collect();
        directories.extend(missing.into_iter().rev());
        if let Err(error) = create(&path, file.content) {
            undo(&created, &directories);
            eprintln!("{command}: can't write {}: {error}. Nothing was added.", file.path);
            return ExitCode::from(1);
        }
        created.push(file);
    }
    if !created.is_empty()
        && let Err(problem) = super::build::compile(&project)
    {
        undo(&created, &directories);
        return refuse(
            &project,
            &problem,
            &format!(
                "{command}: its example doesn't compile next to your code, so nothing was added. If a name is taken, rename yours for a moment or write the tables by hand (docs/config-api.md)."
            ),
        );
    }

    let width = module.files.iter().map(|f| f.path.len()).max().unwrap_or(0);
    if created.is_empty() {
        println!("{command}: nothing to add, every file is already there");
    } else {
        println!("{command}: {}", module.summary);
    }
    for file in module.files {
        if created.iter().any(|c| c.path == file.path) {
            println!("  created  {:width$}  {}", file.path, file.what);
        } else {
            println!("  kept     {:width$}  already there, not changed", file.path);
        }
    }
    if !created.is_empty() {
        println!("\nnext:");
        for line in module.next {
            println!("  {line}");
        }
    }
    ExitCode::SUCCESS
}
