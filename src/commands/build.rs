use crate::cli::USAGE;
use crate::diag::{Diag, Span};
use crate::emit::{self, plugin_vars, runtime_file, write};
use crate::pipeline::{self, Built};
use crate::{diag, loader, platform, schema_php, wp_plugins};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

/// Runs the whole pipeline in memory.
fn build(project: &Path) -> Result<Built, Diag> {
    let entry = project.join("zero.config.ts");
    if !entry.is_file() {
        return Err(Diag::new(
            Span::NONE,
            format!("no zero.config.ts in {}", project.display()),
        ));
    }
    let program = loader::load(&entry)?;
    build_program(project, &program)
}

/// The in-memory pipeline over this project's last snapshot and migration numbering.
fn build_program(project: &Path, program: &loader::Program) -> Result<Built, Diag> {
    pipeline::build(project, program, || read_previous(project), runtime_file)
}

fn migrations_dir(project: &Path) -> PathBuf {
    project.join("zero").join("migrations")
}

/// The last build, from `zero/migrations/`: the snapshot and everything beside it.
fn read_previous(project: &Path) -> Result<pipeline::Previous, Diag> {
    let dir = migrations_dir(project);
    // Only a missing file is a first build. A snapshot that is there but cannot be read (permissions,
    // a directory in its place, not UTF-8) is an error: diffing against an empty schema would plan a
    // migration that recreates every table.
    let snapshot = match std::fs::read_to_string(dir.join("snapshot.json")) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => {
            return Err(Diag::new(
                Span::NONE,
                format!("can't read zero/migrations/snapshot.json: {e}"),
            ));
        }
        Ok(text) => Some(serde_json::from_str(&text).map_err(|e| {
            Diag::new(
                Span::NONE,
                format!("zero/migrations/snapshot.json is not valid JSON: {e}"),
            )
        })?),
    };
    let names = migration_names(&dir)?;
    pipeline::Previous::from_project(snapshot, names.iter().map(String::as_str))
}

/// Every name in `zero/migrations/`. The next migration's number comes from these, so an entry that
/// cannot be listed or named is an error: skipping it could reuse a number that is already taken.
fn migration_names(dir: &Path) -> Result<Vec<String>, Diag> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(Diag::new(Span::NONE, format!("can't read zero/migrations/: {e}"))),
    };
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| Diag::new(Span::NONE, format!("can't read zero/migrations/: {e}")))?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            return Err(Diag::new(
                Span::NONE,
                format!(
                    "zero/migrations/{} is not a UTF-8 file name; rename or remove it",
                    name.to_string_lossy()
                ),
            ));
        };
        names.push(name.to_string());
    }
    Ok(names)
}

/// Writes a file that must not exist yet. A migration is numbered from the files beside it, so one
/// that would land on an existing name is a numbering error and fails here rather than replacing the
/// file.
fn write_new(path: &Path, content: impl AsRef<[u8]>) -> std::io::Result<()> {
    use std::io::Write as _;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| std::io::Error::new(e.kind(), format!("{}: {e}", path.display())))?;
    file.write_all(content.as_ref())
}

/// Writes migrations, the snapshot, zero.gen.ts and the typed client into the project (committed).
fn emit_project(project: &Path, built: &Built) -> std::io::Result<()> {
    let migrations = migrations_dir(project);
    for (name, sql) in &built.migrations {
        write_new(&migrations.join(name), sql)?;
    }
    if !built.migrations.is_empty() || !migrations.join("snapshot.json").is_file() {
        write(
            &migrations.join("snapshot.json"),
            serde_json::to_string_pretty(&built.snapshot)? + "\n",
        )?;
    }
    write(&project.join("zero.gen.ts"), &built.gen_ts)?;
    let client_dir = project.join("zero").join("client");
    for (name, content) in &built.client_files {
        write(&client_dir.join(name), content)?;
    }
    Ok(())
}

fn zip_plugin(directory: &Path) -> std::io::Result<()> {
    use std::io::Write;
    fn append(writer: &mut zip::ZipWriter<std::fs::File>, root: &Path, dir: &Path) -> std::io::Result<()> {
        let mut entries = std::fs::read_dir(dir)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = entry.path();
            if entry.file_type()?.is_dir() {
                append(writer, root, &path)?;
            } else if entry.file_type()?.is_file() {
                writer
                    .start_file(
                        path.strip_prefix(root).unwrap().to_string_lossy(),
                        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
                    )
                    .map_err(std::io::Error::other)?;
                writer.write_all(&std::fs::read(&path)?)?;
            } else {
                return Err(std::io::Error::other(
                    "plugin trees cannot contain symlinks or special files",
                ));
            }
        }
        Ok(())
    }
    let mut writer = zip::ZipWriter::new(std::fs::File::create(directory.with_extension("zip"))?);
    append(&mut writer, directory.parent().unwrap(), directory)?;
    writer.finish().map_err(std::io::Error::other)?;
    Ok(())
}

/// Stage the complete artifact, publish it, then persist the sole dependency lock.
///
/// The stage receives only what this build writes: generated plugins whose previous output differs,
/// dependencies that are new or changed, and the manifests. Everything else in the previous output
/// (unchanged plugins, the user's own plugins, other entries) moves into the stage by rename just
/// before the stage replaces the output. Every check, lint and archive runs first, so a rejected
/// build leaves the previous output and lock untouched.
fn emit_wp_content(project: &Path, root: &Path, built: &Built) -> std::io::Result<PathBuf> {
    let empty = wp_plugins::Config { plugins: Vec::new() };
    let config = built.plugins.as_ref().unwrap_or(&empty);
    let plan = wp_plugins::resolve(config, &platform::plugins(built.schema.locales.is_some()))?;
    let parent = root
        .parent()
        .ok_or_else(|| std::io::Error::other("output needs a parent directory"))?;
    let parent = if parent.as_os_str().is_empty() {
        Path::new(".")
    } else {
        parent
    };
    std::fs::create_dir_all(parent)?;
    let parent = parent.canonicalize()?;
    let root = parent.join(
        root.file_name()
            .ok_or_else(|| std::io::Error::other("output needs a directory name"))?,
    );
    if project.starts_with(&root) || project.join("zero").starts_with(&root) {
        return Err(std::io::Error::other(
            "wp-content output cannot contain the project or its dependency lock",
        ));
    }
    struct Guard(PathBuf, std::fs::File);
    impl Drop for Guard {
        fn drop(&mut self) {
            let _ = self.1.sync_all();
            let _ = std::fs::remove_file(&self.0);
        }
    }
    fn guard(path: PathBuf) -> std::io::Result<Guard> {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| std::io::Error::other(format!("cannot acquire build lock {}: {e}", path.display())))?;
        Ok(Guard(path, file))
    }
    let lock = project.join("zero/wp-plugins.lock.json");
    std::fs::create_dir_all(lock.parent().unwrap())?;
    // Serialize the project lockfile and publication to a shared output root.
    let _project_guard = guard(project.join("zero/.wp-plugins.build.lock"))?;
    let _output_guard = guard(parent.join(format!(
        ".{}.zero-build.lock",
        root.file_name().unwrap().to_string_lossy()
    )))?;
    let prepared = wp_plugins::Prepared::acquire(&plan, &lock, &platform::cache(project))?;
    let existed = match std::fs::symlink_metadata(&root) {
        Ok(meta) if meta.is_dir() => true,
        Ok(_) => return Err(std::io::Error::other("output root must be a real directory")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(e) => return Err(e),
    };
    let previous = match std::fs::symlink_metadata(root.join("plugins")) {
        Ok(meta) if existed && meta.is_dir() => Some(root.join("plugins")),
        Ok(_) => return Err(std::io::Error::other("output plugins must be a real directory")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e),
    };
    // Dependency trees carry over only from output this Zero version wrote; another version may
    // extract or patch archives differently.
    let reusable = std::fs::read(root.join("zero-manifest.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .is_some_and(|manifest| manifest["zero"] == env!("CARGO_PKG_VERSION"));
    let temp = tempfile::tempdir_in(&parent)?;
    let stage = temp.path().join("wp-content");
    let plugins = stage.join("plugins");
    std::fs::create_dir_all(&plugins)?;
    let installed = prepared.install(previous.as_deref(), reusable, &plugins)?;

    let generated = emit::generated(project, &migrations_dir(project), built)?;
    let mut rewritten = Vec::new();
    let mut lint = Vec::new();
    for plugin in &generated {
        let directory = plugins.join(&plugin.slug);
        let unchanged = match &previous {
            Some(previous) => {
                let kept = previous.join(&plugin.slug);
                plugin.matches_tree(&kept)? && plugin.matches_zip(&kept.with_extension("zip"))
            }
            None => false,
        };
        if !unchanged {
            plugin.write(&directory)?;
            lint.extend(plugin.lint_targets(&directory));
            rewritten.push(directory);
        }
    }
    php_lint(&lint).map_err(std::io::Error::other)?;
    for directory in &rewritten {
        zip_plugin(directory)?;
    }
    let mut versions = serde_json::Map::new();
    for plugin in &generated {
        let version = if plugin.slug.starts_with("zero-app-") {
            format!(
                "{}+{}",
                env!("CARGO_PKG_VERSION"),
                plugin_vars(&built.schema, &schema_php::render(&built.schema))
                    .into_iter()
                    .find(|(key, _)| *key == "schemaHash")
                    .unwrap()
                    .1
            )
        } else {
            env!("CARGO_PKG_VERSION").to_string()
        };
        versions.insert(plugin.slug.clone(), version.into());
    }
    for dependency in installed.dependencies() {
        versions.insert(dependency.slug.clone(), dependency.version.clone().into());
    }
    let requires: serde_json::Map<String, serde_json::Value> = platform::plugins(built.schema.locales.is_some())
        .into_iter()
        .map(|plugin| (plugin.slug, format!(">={}", plugin.version).into()))
        .collect();
    write(
        &stage.join("zero-manifest.json"),
        serde_json::to_string_pretty(
            &serde_json::json!({"zero":env!("CARGO_PKG_VERSION"),"runtime":platform::SERIES,"app":built.schema.name,"plugins":versions,"requires":requires,"dependencies":installed.dependencies().collect::<Vec<_>>(),"locales":built.schema.locales}),
        )? + "\n",
    )?;
    super::deploy::write_metadata(&stage, built)?;
    let lock_bytes = installed.lock_bytes()?;
    let mut lock_file = tempfile::NamedTempFile::new_in(lock.parent().unwrap())?;
    std::io::Write::write_all(&mut lock_file, &lock_bytes)?;

    // Admin is owned here even after its opt-in is removed: an old copy is dropped, not carried.
    let dropped: &[&str] = if built.schema.admin {
        &[]
    } else {
        &["zero-admin", "zero-admin.zip"]
    };
    let backup = temp.path().join("previous");
    if existed {
        std::fs::rename(&root, &backup)?;
    }
    let carried = if existed {
        match carry(&backup, &stage, dropped) {
            Ok(carried) => carried,
            Err(e) => {
                std::fs::rename(&backup, &root)?;
                return Err(e);
            }
        }
    } else {
        Vec::new()
    };
    let restore = || -> std::io::Result<()> {
        if existed {
            uncarry(&carried, &stage, &backup)?;
            std::fs::rename(&backup, &root)?;
        }
        Ok(())
    };
    if let Err(e) = std::fs::rename(&stage, &root) {
        restore()?;
        return Err(e);
    }
    if let Err(e) = lock_file.persist(&lock) {
        std::fs::rename(&root, &stage)?;
        restore()?;
        return Err(e.error);
    }
    let legacy = project.join(".zero/wp");
    if !root.starts_with(&legacy) && legacy.is_dir() {
        std::fs::remove_dir_all(legacy)?;
    }
    Ok(root)
}

/// Moves every entry of the previous output that the stage did not replace into the stage: top-level
/// entries and entries of `plugins/`, except names in `dropped`. Returns the moved paths, relative to
/// both roots. On failure, moves what it already moved back and returns the error.
fn carry(previous: &Path, stage: &Path, dropped: &[&str]) -> std::io::Result<Vec<PathBuf>> {
    let mut carried = Vec::new();
    let mut each = |rel: &Path, skip: &[&str]| -> std::io::Result<()> {
        let directory = previous.join(rel);
        if !std::fs::symlink_metadata(&directory).is_ok_and(|meta| meta.is_dir()) {
            return Ok(());
        }
        for entry in std::fs::read_dir(&directory)? {
            let name = entry?.file_name();
            let rel = rel.join(&name);
            if skip.iter().any(|skip| name == *skip) || std::fs::symlink_metadata(stage.join(&rel)).is_ok() {
                continue;
            }
            std::fs::rename(previous.join(&rel), stage.join(&rel))?;
            carried.push(rel);
        }
        Ok(())
    };
    let result = each(Path::new(""), &[]).and_then(|()| each(Path::new("plugins"), dropped));
    match result {
        Ok(()) => Ok(carried),
        Err(e) => {
            uncarry(&carried, stage, previous)?;
            Err(e)
        }
    }
}

fn uncarry(carried: &[PathBuf], stage: &Path, previous: &Path) -> std::io::Result<()> {
    for rel in carried.iter().rev() {
        std::fs::rename(stage.join(rel), previous.join(rel))?;
    }
    Ok(())
}

/// Lints PHP files with as few `php` processes as possible: `php -l a.php b.php …` checks every
/// argument on PHP 8.3+. A file the batch did not report clean (an older PHP checks only the first
/// argument, or the file has an error) is linted on its own, so its own message is returned.
fn php_lint(files: &[PathBuf]) -> Result<(), String> {
    let lint = |chunk: &[PathBuf]| std::process::Command::new("php").arg("-l").args(chunk).output();
    let mut clean = std::collections::BTreeSet::new();
    for chunk in files.chunks(256) {
        let Ok(output) = lint(chunk) else {
            return Ok(()); // no PHP on this machine: skip the lint
        };
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Some(path) = line.strip_prefix("No syntax errors detected in ") {
                clean.insert(PathBuf::from(path));
            }
        }
    }
    for path in files.iter().filter(|path| !clean.contains(*path)) {
        match lint(std::slice::from_ref(path)) {
            Ok(o) if o.status.success() => {}
            Ok(o) => {
                return Err(format!(
                    "{}{}",
                    String::from_utf8_lossy(&o.stdout),
                    String::from_utf8_lossy(&o.stderr)
                ));
            }
            Err(_) => return Ok(()),
        }
    }
    Ok(())
}

fn check_json(project: &Path) -> ExitCode {
    let diagnostics = match loader::load_all(&project.join("zero.config.ts")) {
        Err(diagnostics) => diagnostics,
        Ok(program) => build_program(project, &program).err().into_iter().collect(),
    };
    println!(
        "{}",
        serde_json::to_string(&diag::envelope(&diagnostics, project)).expect("diagnostic envelope serializes")
    );
    if diagnostics.is_empty() {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}

pub(super) fn run(args: &crate::cli::Args) -> ExitCode {
    let project = args.project.canonicalize().unwrap_or(args.project.clone());
    if !matches!(args.command.as_str(), "build" | "check") {
        eprintln!("unknown command {}\n{USAGE}", args.command);
        return ExitCode::from(2);
    }
    if args.command == "check" && args.json {
        return check_json(&project);
    }
    let started = std::time::Instant::now();
    let built = match build(&project) {
        Ok(b) => b,
        Err(d) => {
            eprint!("{}", diag::render(&d, &project));
            return ExitCode::from(1);
        }
    };
    if args.command == "check" {
        if !args.quiet {
            for h in &built.hints {
                eprintln!("hint: {h}");
            }
        }
        println!("ok: {} ({:.0?})", built.summary(), started.elapsed());
        return ExitCode::SUCCESS;
    }

    // Dev supplies its last successfully applied snapshot. Check the exact candidate before
    // emitting either a migration or a snapshot, so a rejected save cannot poison the next build.
    if let Some(path) = &args.preserve_data {
        let previous =
            match std::fs::read(path).and_then(|bytes| serde_json::from_slice(&bytes).map_err(std::io::Error::other)) {
                Ok(previous) => previous,
                Err(error) => {
                    eprintln!("error: can't read preservation snapshot {}: {error}", path.display());
                    return ExitCode::from(1);
                }
            };
        let problems = crate::migrate::preservation_problems(&previous, &built.snapshot);
        if !problems.is_empty() {
            eprintln!(
                "error: {}. Local data was preserved. Review migrations, then restart once with --allow-destructive to apply deliberately.",
                problems.join("; ")
            );
            return ExitCode::from(1);
        }
    }

    if let Err(e) = emit_project(&project, &built) {
        eprintln!("error: couldn't write migrations or the client: {e}");
        return ExitCode::from(1);
    }
    // A project that syncs commits its sync bases, and nothing else under .zero (design §5.4).
    if built.schema.collections.values().any(|c| c.sync.is_some())
        && let Err(e) = crate::sync::git::ignore_build_output(&project)
    {
        eprintln!("error: {e}");
        return ExitCode::from(1);
    }
    let root = args.out.clone().unwrap_or_else(|| project.join(".zero/wp-content"));
    let out = match emit_wp_content(&project, &root, &built) {
        Ok(directory) => directory,
        Err(error) => {
            eprintln!("error: couldn't write wp-content: {error}");
            return ExitCode::from(1);
        }
    };
    for w in &built.warnings {
        eprintln!("warning: this migration {w}");
    }
    if !args.quiet {
        for h in &built.hints {
            eprintln!("hint: {h}");
        }
    }
    let shown = out.strip_prefix(&project).unwrap_or(&out).display().to_string();
    let new: Vec<String> = built
        .migrations
        .iter()
        .map(|(n, _)| format!("zero/migrations/{n}"))
        .collect();
    let suffix = if new.is_empty() {
        String::new()
    } else {
        format!(" (new migrations {})", new.join(", "))
    };
    println!(
        "built {} -> {shown}{suffix} in {:.0?}",
        built.summary(),
        started.elapsed()
    );
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::read_previous;

    #[test]
    fn a_snapshot_that_cannot_be_read_is_an_error_not_a_first_build() {
        let project = tempfile::tempdir().unwrap();
        // A directory where the file should be: readable as a path, not as a snapshot.
        std::fs::create_dir_all(project.path().join("zero/migrations/snapshot.json")).unwrap();
        let error = read_previous(project.path()).unwrap_err();
        assert!(
            error.message.starts_with("can't read zero/migrations/snapshot.json: "),
            "{}",
            error.message
        );
    }

    #[test]
    fn a_migration_file_name_that_is_not_utf8_is_an_error_not_skipped() {
        use std::os::unix::ffi::OsStrExt as _;
        let project = tempfile::tempdir().unwrap();
        let dir = project.path().join("zero/migrations");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("0001_init.sql"), "").unwrap();
        std::fs::write(dir.join(std::ffi::OsStr::from_bytes(b"0002_\xff.sql")), "").unwrap();
        let error = read_previous(project.path()).unwrap_err();
        assert!(error.message.contains("is not a UTF-8 file name"), "{}", error.message);
    }

    #[test]
    fn a_new_migration_never_replaces_a_file_that_is_already_there() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("zero/migrations/0002_update.sql");
        super::write_new(&path, "first").unwrap();
        let error = super::write_new(&path, "second").unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "first");
    }

    #[test]
    fn a_missing_snapshot_is_a_first_build() {
        let project = tempfile::tempdir().unwrap();
        let previous = read_previous(project.path()).unwrap();
        assert_eq!(previous.next_migration, 1);
        assert_eq!(previous.snapshot["tables"], serde_json::json!({}));
    }
}
