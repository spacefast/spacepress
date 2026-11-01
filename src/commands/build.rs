use crate::cli::USAGE;
use crate::diag::{Diag, Span};
use crate::pipeline::{self, Built};
use crate::{diag, loader, platform, runtime_files, schema, schema_php, wp_plugins};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

pub(crate) fn validate_config(project: &Path) -> Result<(), Diag> {
    build(project).map(|_| ())
}

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
    let names: Vec<String> = match std::fs::read_dir(&dir) {
        Ok(entries) => entries
            .filter_map(|e| Some(e.ok()?.file_name().to_str()?.to_string()))
            .collect(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(Diag::new(Span::NONE, format!("can't read zero/migrations/: {e}"))),
    };
    pipeline::Previous::from_project(snapshot, names.iter().map(String::as_str))
}

fn write(path: &Path, content: impl AsRef<[u8]>) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, content)
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            std::fs::create_dir_all(&target)?;
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn copy_sql(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    if from.is_dir() {
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            if entry.path().extension().is_some_and(|e| e == "sql") {
                std::fs::copy(entry.path(), to.join(entry.file_name()))?;
            }
        }
    }
    Ok(())
}

fn runtime_file(rel: &str) -> Option<&'static [u8]> {
    runtime_files::FILES.iter().find(|(p, _)| *p == rel).map(|(_, b)| *b)
}

/// Writes migrations, the snapshot, zero.gen.ts and the typed client into the project (committed).
fn emit_project(project: &Path, built: &Built) -> std::io::Result<()> {
    let migrations = migrations_dir(project);
    for (name, sql) in &built.migrations {
        write(&migrations.join(name), sql)?;
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

/// Generated plugins are prepared in the same private tree as acquired dependencies.
fn emit_generated(project: &Path, plugins: &Path, built: &Built) -> std::io::Result<()> {
    let schema_php = schema_php::render(&built.schema);
    let vars = plugin_vars(&built.schema, &schema_php);
    for (slug, name) in [
        ("zero-runtime".to_string(), "zero-runtime"),
        (format!("zero-app-{}", built.schema.name), "zero-app"),
    ] {
        let directory = plugins.join(&slug);
        std::fs::create_dir_all(&directory)?;
        let template = runtime_file(&format!("wp-plugin/{name}.php")).expect("embedded plugin template");
        write(
            &directory.join(format!("{slug}.php")),
            substitute(&String::from_utf8_lossy(template), &vars),
        )?;
        // Deleting the plugin in wp-admin runs uninstall.php: options and capabilities go, content stays.
        let uninstall = runtime_file(&format!("wp-plugin/{name}-uninstall.php")).expect("embedded uninstall template");
        write(&directory.join("uninstall.php"), uninstall)?;
        write(
            &directory.join("readme.txt"),
            format!(
                "=== {slug} ===\nStable tag: {}\nLicense: GPL-2.0-or-later\n",
                env!("CARGO_PKG_VERSION")
            ),
        )?;
        if slug == "zero-runtime" {
            for (rel, bytes) in runtime_files::FILES {
                if let Some(rest) = rel.strip_prefix("Zero/") {
                    write(&directory.join("zero").join(rest), bytes)?;
                }
            }
        } else {
            // The app plugin declares GPL-2.0-or-later like the runtime it extends; carry the text.
            if let Some(license) = runtime_file("Zero/LICENSE") {
                write(&directory.join("LICENSE"), license)?;
            }
            write(&directory.join("zero/app/schema.php"), &schema_php)?;
            if let Some(wpml) = crate::wpml_config::render(&built.schema) {
                write(&directory.join("wpml-config.xml"), wpml)?;
            }
            write(&directory.join("zero/app/functions.php"), &built.functions_php)?;
            copy_sql(&migrations_dir(project), &directory.join("zero/app/migrations"))?;
            let public = project.join("public");
            if public.is_dir() {
                copy_dir(&public, &directory.join("public"))?;
            }
        }
    }
    for (rel, bytes) in runtime_files::FILES {
        if let Some(rest) = rel.strip_prefix("identity/") {
            write(&plugins.join("zero-identity").join(rest), bytes)?;
        }
        // The optional admin screens: only when the config opted in. The embedded tree is the
        // committed plugin (PHP, routes.js, notices, the built modules); its header carries the
        // same version placeholders as the generated plugins.
        if built.schema.admin
            && let Some(rest) = rel.strip_prefix("admin/")
        {
            let target = plugins.join("zero-admin").join(rest);
            if rest == "zero-admin.php" {
                write(&target, substitute(&String::from_utf8_lossy(bytes), &vars))?;
            } else {
                write(&target, bytes)?;
            }
        }
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
    let temp = tempfile::tempdir_in(&parent)?;
    let stage = temp.path().join("wp-content");
    if std::fs::symlink_metadata(&root).is_ok() {
        if !std::fs::symlink_metadata(&root)?.is_dir() {
            return Err(std::io::Error::other("output root must be a real directory"));
        }
        wp_plugins::copy_output(&root, &stage)?;
    } else {
        std::fs::create_dir(&stage)?;
    }
    prepared.install_into(&stage.join("plugins"))?;
    let plugins = stage.join("plugins");
    for entry in std::fs::read_dir(&plugins)? {
        let entry = entry?;
        if entry.file_name().to_string_lossy().starts_with("zero-") {
            if entry.file_type()?.is_dir() {
                std::fs::remove_dir_all(entry.path())?;
            } else {
                std::fs::remove_file(entry.path())?;
            }
        }
    }
    emit_generated(project, &plugins, built)?;
    let mut versions = serde_json::Map::new();
    let mut generated = vec![
        "zero-runtime".to_string(),
        "zero-identity".to_string(),
        format!("zero-app-{}", built.schema.name),
    ];
    if built.schema.admin {
        generated.push("zero-admin".to_string());
    }
    for slug in generated {
        let directory = plugins.join(&slug);
        php_lint_tree(&directory)?;
        zip_plugin(&directory)?;
        let version = if slug.starts_with("zero-app-") {
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
        versions.insert(slug, version.into());
    }
    for dependency in prepared.dependencies() {
        versions.insert(dependency.slug.clone(), dependency.version.clone().into());
    }
    let requires: serde_json::Map<String, serde_json::Value> = platform::plugins(built.schema.locales.is_some())
        .into_iter()
        .map(|plugin| (plugin.slug, format!(">={}", plugin.version).into()))
        .collect();
    write(
        &stage.join("zero-manifest.json"),
        serde_json::to_string_pretty(
            &serde_json::json!({"zero":env!("CARGO_PKG_VERSION"),"runtime":platform::SERIES,"app":built.schema.name,"plugins":versions,"requires":requires,"dependencies":prepared.dependencies().collect::<Vec<_>>(),"locales":built.schema.locales}),
        )? + "\n",
    )?;
    let lock_bytes = prepared.lock_bytes()?;
    std::fs::create_dir_all(lock.parent().unwrap())?;
    let mut lock_file = tempfile::NamedTempFile::new_in(lock.parent().unwrap())?;
    std::io::Write::write_all(&mut lock_file, &lock_bytes)?;
    let backup = temp.path().join("previous");
    let existed = root.exists();
    if existed {
        std::fs::rename(&root, &backup)?;
    }
    if let Err(e) = std::fs::rename(&stage, &root) {
        if existed {
            std::fs::rename(&backup, &root)?;
        }
        return Err(e);
    }
    if let Err(e) = lock_file.persist(&lock) {
        std::fs::remove_dir_all(&root)?;
        if existed {
            std::fs::rename(&backup, &root)?;
        }
        return Err(e.error);
    }
    let legacy = project.join(".zero/wp");
    if !root.starts_with(&legacy) && legacy.is_dir() {
        std::fs::remove_dir_all(legacy)?;
    }
    Ok(root)
}

fn plugin_vars(schema: &schema::Schema, schema_php: &str) -> Vec<(&'static str, String)> {
    let hash = {
        // FNV-1a: a stable fingerprint of the built schema (changes when the plugin must migrate).
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for b in schema_php.bytes() {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
        format!("{h:016x}")
    };
    let label = schema::title_case(&schema.name);
    vec![
        ("name", schema.name.clone()),
        ("slug", format!("zero-app-{}", schema.name)),
        ("runtimeSeries", platform::SERIES.to_string()),
        ("wpVersion", platform::WORDPRESS.to_string()),
        ("phpVersion", platform::PHP.to_string()),
        (
            "requires",
            if schema.locales.is_some() {
                "secure-custom-fields, action-scheduler, mcp-adapter, zero-runtime, polylang"
            } else {
                "secure-custom-fields, action-scheduler, mcp-adapter, zero-runtime"
            }
            .to_string(),
        ),
        ("label", label.clone()),
        ("Name", label),
        ("version", env!("CARGO_PKG_VERSION").to_string()),
        ("schemaHash", hash),
        ("zeroVersion", env!("CARGO_PKG_VERSION").to_string()),
    ]
}

/// `{{key}}` → value. Unknown placeholders are left as they are.
fn substitute(text: &str, vars: &[(&str, String)]) -> String {
    let mut out = text.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("{{{{{k}}}}}"), v);
    }
    out
}

fn php_lint(files: &[PathBuf]) -> Result<(), String> {
    for path in files {
        let result = std::process::Command::new("php").arg("-l").arg(path).output();
        match result {
            Ok(o) if o.status.success() => {}
            Ok(o) => {
                return Err(format!(
                    "{}{}",
                    String::from_utf8_lossy(&o.stdout),
                    String::from_utf8_lossy(&o.stderr)
                ));
            }
            Err(_) => return Ok(()), // no PHP on this machine: skip the lint
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
    if !matches!(args.command.as_str(), "build" | "check" | "dev") {
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
    if args.command == "dev" {
        return super::dev::wp(&out, args.port);
    }
    ExitCode::SUCCESS
}

fn php_lint_tree(directory: &Path) -> std::io::Result<()> {
    let mut php = Vec::new();
    fn collect(directory: &Path, files: &mut Vec<PathBuf>) -> std::io::Result<()> {
        for entry in std::fs::read_dir(directory)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() && entry.file_name() != "vendor-prefixed" {
                collect(&entry.path(), files)?;
            } else if entry.path().extension().is_some_and(|extension| extension == "php") {
                files.push(entry.path());
            }
        }
        Ok(())
    }
    collect(directory, &mut php)?;
    php_lint(&php).map_err(std::io::Error::other)
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
    fn a_missing_snapshot_is_a_first_build() {
        let project = tempfile::tempdir().unwrap();
        let previous = read_previous(project.path()).unwrap();
        assert_eq!(previous.next_migration, 1);
        assert_eq!(previous.snapshot["tables"], serde_json::json!({}));
    }
}
