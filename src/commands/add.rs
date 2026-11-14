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
use crate::schema::Schema;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

/// When a file belongs in the project, beyond its path being free.
enum When {
    Always,
    /// An example of the module's own kinds: only for a project that has no `table()` yet, so an
    /// author who moved or renamed the example doesn't get it back.
    NoTables,
    /// Code that calls these tables: only when the project has them.
    Tables(&'static [&'static str]),
}

struct File {
    /// Relative to the project root, with `/` separators.
    path: &'static str,
    content: &'static str,
    what: &'static str,
    when: When,
}

struct Module {
    name: &'static str,
    summary: &'static str,
    files: &'static [File],
    /// What to do next, one line each.
    next: &'static [&'static str],
}

const MODULES: &[Module] = &[Module {
    name: "db",
    summary: "SQL tables beside your WordPress content: table(), foreign keys, a schema check at deploy",
    files: &[
        File {
            path: "first/tables.ts",
            content: include_str!("add/db/tables.ts"),
            what: "two example tables, with a reference between them and access rules",
            when: When::NoTables,
        },
        File {
            path: "tables.client.ts",
            content: include_str!("add/db/tables.client.ts"),
            what: "typed client calls for the example tables",
            when: When::Tables(&["projects", "tasks"]),
        },
        File {
            path: "first/DATABASE.md",
            content: include_str!("add/db/DATABASE.md"),
            what: "how tables, migrations and the deploy check work",
            when: When::Always,
        },
    ],
    next: &[
        "first build   writes the SQL for new tables to first/_generated/migrations/ (commit it)",
        "first dev     applies it to the local site",
        "tsc           checks the new files once tsconfig.json includes them (first/DATABASE.md)",
    ],
}];

/// The modules, one line each, for usage errors and `first help add`.
pub(crate) fn modules() -> String {
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

fn table(schema: &Schema, key: Option<&str>) -> bool {
    schema
        .collections
        .values()
        .any(|c| !c.editor && !c.auth && c.taxonomy.is_none() && key.is_none_or(|key| c.key == key))
}

/// Why `file` doesn't belong in a project with this schema, or None when it does.
fn skip(file: &File, schema: &Schema) -> Option<String> {
    match file.when {
        When::Always => None,
        When::NoTables => table(schema, None).then(|| "the project already has tables".to_string()),
        When::Tables(names) => names
            .iter()
            .find(|name| !table(schema, Some(name)))
            .map(|name| format!("it calls the example table `{name}`, which the project doesn't have")),
    }
}

/// What a run created, in order, so a failed run can take all of it out again.
#[derive(Default)]
struct Created {
    files: Vec<&'static str>,
    directories: Vec<PathBuf>,
}

impl Created {
    /// Creates `path` with `content`, and the directories it needs. Fails when something is
    /// already there, so a file that appeared since [`occupied`] looked is never replaced. A file
    /// that could not be written whole is removed.
    fn file(&mut self, project: &Path, path: &'static str, content: &str) -> std::io::Result<()> {
        let full = project.join(path);
        let mut missing: Vec<PathBuf> = full
            .ancestors()
            .skip(1)
            .take_while(|directory| !occupied(directory))
            .map(Path::to_path_buf)
            .collect();
        missing.reverse();
        for directory in missing {
            std::fs::create_dir(&directory)?;
            self.directories.push(directory);
        }
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&full)?;
        self.files.push(path);
        file.write_all(content.as_bytes())
    }

    fn undo(&self, project: &Path) {
        for file in &self.files {
            let _ = std::fs::remove_file(project.join(file));
        }
        // Only a directory this run made, and only while it is empty.
        for directory in self.directories.iter().rev() {
            let _ = std::fs::remove_dir(directory);
        }
    }
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
    if !project.join("first.config.ts").is_file() {
        eprintln!(
            "{command}: no first.config.ts in {}. Run it in a First project, or pass the project's directory.",
            project.display()
        );
        return ExitCode::from(1);
    }
    let refuse = |problem: &Diag, message: &str| {
        eprint!("{}", diag::render(problem, &project));
        eprintln!("{command}: {message}");
        ExitCode::from(1)
    };

    let mut schema = match super::build::compile(&project) {
        Ok(schema) => schema,
        Err(problem) => return refuse(&problem, "the project has to compile first. Nothing was added."),
    };
    let mut created = Created::default();
    // Each file is judged against the project as it is with the files before it, so a file that
    // calls the example's tables sees them once they are written.
    let mut compiled = 0;
    let mut report = Vec::new();
    for file in module.files {
        if occupied(&project.join(file.path)) {
            report.push((file, "kept   ", "already there, not changed".to_string()));
            continue;
        }
        if !matches!(file.when, When::Always) && compiled < created.files.len() {
            schema = match super::build::compile(&project) {
                Ok(schema) => schema,
                Err(problem) => {
                    created.undo(&project);
                    return refuse(
                        &problem,
                        "its files don't compile next to your code, so nothing was added. If a name is taken, rename yours for a moment and run it again.",
                    );
                }
            };
            compiled = created.files.len();
        }
        if let Some(why) = skip(file, &schema) {
            report.push((file, "skipped", why));
            continue;
        }
        if let Err(error) = created.file(&project, file.path, file.content) {
            created.undo(&project);
            eprintln!("{command}: can't write {}: {error}. Nothing was added.", file.path);
            return ExitCode::from(1);
        }
        report.push((file, "created", file.what.to_string()));
    }
    if compiled < created.files.len()
        && let Err(problem) = super::build::compile(&project)
    {
        created.undo(&project);
        return refuse(
            &problem,
            "its files don't compile next to your code, so nothing was added. If a name is taken, rename yours for a moment and run it again.",
        );
    }

    if created.files.is_empty() {
        println!("{command}: nothing to add");
    } else {
        println!("{command}: {}", module.summary);
    }
    let width = module.files.iter().map(|f| f.path.len()).max().unwrap_or(0);
    for (file, status, detail) in &report {
        println!("  {status}  {:width$}  {detail}", file.path);
    }
    if !created.files.is_empty() {
        println!("\nnext:");
        for line in module.next {
            println!("  {line}");
        }
    }
    ExitCode::SUCCESS
}
