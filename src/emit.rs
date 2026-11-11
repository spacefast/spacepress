pub(crate) use crate::app_plugin::plugin_vars;
use crate::app_plugin::{readme, substitute};
use crate::{pipeline::Built, platform, runtime_files, schema_php};
use std::path::Path;

pub(crate) fn write(path: &Path, content: impl AsRef<[u8]>) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, content)
}

/// Every file under `root`, by `/`-separated path below it, sorted.
fn read_tree(root: &Path) -> std::io::Result<Vec<(String, Vec<u8>)>> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) -> std::io::Result<()> {
        let mut entries = std::fs::read_dir(dir)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = entry.path();
            if entry.file_type()?.is_dir() {
                walk(root, &path, out)?;
            } else {
                let rel = path
                    .strip_prefix(root)
                    .expect("under root")
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push((rel, std::fs::read(&path)?));
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk(root, root, &mut out)?;
    Ok(out)
}

/// The ledger's `.sql` files, by name.
fn read_sql(dir: &Path) -> std::io::Result<Vec<(String, Vec<u8>)>> {
    let mut out = Vec::new();
    if dir.is_dir() {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            if entry.path().extension().is_some_and(|e| e == "sql") {
                out.push((
                    entry.file_name().to_string_lossy().into_owned(),
                    std::fs::read(entry.path())?,
                ));
            }
        }
    }
    Ok(out)
}

pub(crate) fn runtime_file(rel: &str) -> Option<&'static [u8]> {
    runtime_files::FILES.iter().find(|(p, _)| *p == rel).map(|(_, b)| *b)
}

/// The schema-independent plugins: `first-runtime`, `first-identity` and `first-admin`, as
/// (path below the plugins directory, bytes). Identical for every app built by this compiler, so a
/// build store writes the tree once per revision.
pub(crate) fn runtime_tree() -> Vec<(String, std::borrow::Cow<'static, [u8]>)> {
    use std::borrow::Cow;
    let vars = [
        ("wpVersion", platform::WORDPRESS.to_string()),
        ("phpVersion", platform::PHP.to_string()),
        ("firstVersion", env!("CARGO_PKG_VERSION").to_string()),
        // Every platform plugin Runtime::activate() requires; Polylang only with an app's `locales`.
        (
            "runtimeRequires",
            platform::plugins(false)
                .into_iter()
                .map(|p| p.slug)
                .collect::<Vec<_>>()
                .join(", "),
        ),
    ];
    let template = runtime_file("wp-plugin/first-runtime.php").expect("embedded plugin template");
    let uninstall = runtime_file("wp-plugin/first-runtime-uninstall.php").expect("embedded uninstall template");
    let mut files: Vec<(String, Cow<'static, [u8]>)> = vec![
        (
            "first-runtime/first-runtime.php".into(),
            Cow::Owned(substitute(&String::from_utf8_lossy(template), &vars).into_bytes()),
        ),
        // Deleting the plugin in wp-admin runs uninstall.php: options and capabilities go, content stays.
        ("first-runtime/uninstall.php".into(), Cow::Borrowed(uninstall)),
        (
            "first-runtime/readme.txt".into(),
            Cow::Owned(readme("first-runtime").into_bytes()),
        ),
        // The build store's loader, which the host requires to mount one build.
        (
            "first-loader.php".into(),
            Cow::Borrowed(runtime_file("wp-plugin/first-loader.php").expect("embedded loader")),
        ),
    ];
    for (rel, bytes) in runtime_files::FILES {
        if let Some(rest) = rel.strip_prefix("First/") {
            files.push((format!("first-runtime/first/{rest}"), Cow::Borrowed(*bytes)));
        } else if let Some(rest) = rel.strip_prefix("identity/") {
            files.push((format!("first-identity/{rest}"), Cow::Borrowed(*bytes)));
        } else if let Some(rest) = rel.strip_prefix("admin/") {
            // The committed admin plugin (PHP, routes.js, notices, the built modules); its header
            // carries the same version placeholders as the generated plugins.
            let bytes = if rest == "first-admin.php" {
                Cow::Owned(substitute(&String::from_utf8_lossy(bytes), &vars).into_bytes())
            } else {
                Cow::Borrowed(*bytes)
            };
            files.push((format!("first-admin/{rest}"), bytes));
        }
    }
    files
}

/// Generated plugins are prepared in the same private tree as acquired dependencies. Without
/// `runtime`, only the app plugin is written (the build store holds the runtime tree separately).
pub(crate) fn emit_generated(
    project: &Path,
    migrations: &Path,
    plugins: &Path,
    built: &Built,
    runtime: bool,
) -> std::io::Result<()> {
    let schema_php = schema_php::render(&built.schema);
    if runtime {
        for (rel, bytes) in runtime_tree() {
            // The optional admin screens: only when the config opted in.
            if rel != "first-loader.php" && (built.schema.admin || !rel.starts_with("first-admin/")) {
                write(&plugins.join(rel), bytes)?;
            }
        }
    }
    // The migrations directory exists even when the ledger has no SQL yet, as it always has.
    std::fs::create_dir_all(plugins.join(format!("first-app-{}/first/app/migrations", built.schema.name)))?;
    let public = project.join("public");
    let public = if public.is_dir() {
        read_tree(&public)?
    } else {
        Vec::new()
    };
    for (rel, bytes) in crate::app_plugin::files(built, &schema_php, read_sql(migrations)?, public) {
        write(&plugins.join(rel), bytes)?;
    }
    Ok(())
}
