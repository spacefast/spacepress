use crate::{pipeline::Built, platform, runtime_files, schema, schema_php};
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

pub(crate) fn write(path: &Path, content: impl AsRef<[u8]>) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, content)
}

/// One generated plugin, held in memory so a build can compare it with the previous output before
/// writing anything. Paths are relative to the plugin directory and use `/`.
pub(crate) struct Generated {
    pub slug: String,
    files: BTreeMap<String, GeneratedFile>,
    /// Directories created even when empty (an app without migrations still has the directory).
    dirs: BTreeSet<String>,
}

struct GeneratedFile {
    bytes: Cow<'static, [u8]>,
    /// Copied verbatim from the binary: identical for every build, so Zero's own tests lint it.
    embedded: bool,
}

impl Generated {
    fn new(slug: String) -> Self {
        Self {
            slug,
            files: BTreeMap::new(),
            dirs: BTreeSet::new(),
        }
    }

    fn embedded(&mut self, rel: impl Into<String>, bytes: &'static [u8]) {
        let file = GeneratedFile {
            bytes: Cow::Borrowed(bytes),
            embedded: true,
        };
        self.files.insert(rel.into(), file);
    }

    fn built(&mut self, rel: impl Into<String>, bytes: impl Into<Vec<u8>>) {
        let file = GeneratedFile {
            bytes: Cow::Owned(bytes.into()),
            embedded: false,
        };
        self.files.insert(rel.into(), file);
    }

    /// Every directory in the tree: each file's ancestors plus the explicitly empty ones.
    fn directories(&self) -> BTreeSet<&str> {
        let mut dirs: BTreeSet<&str> = self.dirs.iter().map(String::as_str).collect();
        for rel in self.files.keys() {
            let mut rest = rel.as_str();
            while let Some((parent, _)) = rest.rsplit_once('/') {
                dirs.insert(parent);
                rest = parent;
            }
        }
        dirs
    }

    pub fn write(&self, directory: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(directory)?;
        for rel in &self.dirs {
            std::fs::create_dir_all(directory.join(rel))?;
        }
        for (rel, file) in &self.files {
            write(&directory.join(rel), &file.bytes)?;
        }
        Ok(())
    }

    /// PHP files this build produced from the project. Verbatim runtime files are linted by Zero's tests.
    pub fn lint_targets(&self, directory: &Path) -> Vec<std::path::PathBuf> {
        self.files
            .iter()
            .filter(|(rel, file)| !file.embedded && rel.ends_with(".php"))
            .map(|(rel, _)| directory.join(rel))
            .collect()
    }

    /// True when `directory` holds exactly this tree: the same files with the same bytes, the same
    /// directories, and nothing else (no extra files, links or special files).
    pub fn matches_tree(&self, directory: &Path) -> std::io::Result<bool> {
        fn walk(
            generated: &Generated,
            dirs: &BTreeSet<&str>,
            root: &Path,
            rel: &str,
            seen: &mut (usize, usize),
        ) -> std::io::Result<bool> {
            for entry in std::fs::read_dir(root.join(rel))? {
                let entry = entry?;
                let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                    return Ok(false);
                };
                let child = if rel.is_empty() { name } else { format!("{rel}/{name}") };
                let kind = entry.file_type()?;
                if kind.is_dir() {
                    if !dirs.contains(child.as_str()) || !walk(generated, dirs, root, &child, seen)? {
                        return Ok(false);
                    }
                    seen.1 += 1;
                } else if kind.is_file() {
                    let Some(file) = generated.files.get(&child) else {
                        return Ok(false);
                    };
                    if entry.metadata()?.len() != file.bytes.len() as u64
                        || std::fs::read(entry.path())? != file.bytes.as_ref()
                    {
                        return Ok(false);
                    }
                    seen.0 += 1;
                } else {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        match std::fs::symlink_metadata(directory) {
            Ok(meta) if meta.is_dir() => {}
            Ok(_) => return Ok(false),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(e),
        }
        let dirs = self.directories();
        let mut seen = (0, 0);
        Ok(walk(self, &dirs, directory, "", &mut seen)? && seen == (self.files.len(), dirs.len()))
    }

    /// True when `archive` is this plugin's ZIP: one entry per file under `<slug>/`, each with this
    /// build's size and CRC-32. Reads only the central directory.
    #[cfg(feature = "cli")]
    pub fn matches_zip(&self, archive: &Path) -> bool {
        let Ok(file) = std::fs::File::open(archive) else {
            return false;
        };
        let Ok(mut zip) = zip::ZipArchive::new(file) else {
            return false;
        };
        if zip.len() != self.files.len() {
            return false;
        }
        let prefix = format!("{}/", self.slug);
        (0..zip.len()).all(|i| {
            let Ok(entry) = zip.by_index_raw(i) else {
                return false;
            };
            let Ok(name) = entry.name() else {
                return false;
            };
            let Some(file) = name.strip_prefix(&prefix).and_then(|rel| self.files.get(rel)) else {
                return false;
            };
            entry.size() == file.bytes.len() as u64 && entry.crc32() == crc32fast::hash(&file.bytes)
        })
    }
}

fn read_dir_into(generated: &mut Generated, from: &Path, rel: &str) -> std::io::Result<()> {
    generated.dirs.insert(rel.to_string());
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name
            .to_str()
            .ok_or_else(|| std::io::Error::other(format!("{}: not a UTF-8 file name", entry.path().display())))?;
        let child = format!("{rel}/{name}");
        if entry.file_type()?.is_dir() {
            read_dir_into(generated, &entry.path(), &child)?;
        } else {
            generated.built(child, std::fs::read(entry.path())?);
        }
    }
    Ok(())
}

fn read_sql_into(generated: &mut Generated, from: &Path, rel: &str) -> std::io::Result<()> {
    generated.dirs.insert(rel.to_string());
    if from.is_dir() {
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            if entry.path().extension().is_some_and(|e| e == "sql") {
                let name = entry.file_name();
                let name = name
                    .to_str()
                    .ok_or_else(|| std::io::Error::other(format!("{}: not a UTF-8 file name", entry.path().display())))?;
                generated.built(format!("{rel}/{name}"), std::fs::read(entry.path())?);
            }
        }
    }
    Ok(())
}

pub(crate) fn runtime_file(rel: &str) -> Option<&'static [u8]> {
    runtime_files::FILES.iter().find(|(p, _)| *p == rel).map(|(_, b)| *b)
}

/// The generated plugins, in activation order: runtime, identity, the app, then admin when opted in.
pub(crate) fn generated(project: &Path, migrations: &Path, built: &Built) -> std::io::Result<Vec<Generated>> {
    let schema_php = schema_php::render(&built.schema);
    let vars = plugin_vars(&built.schema, &schema_php);
    let mut runtime = Generated::new("zero-runtime".to_string());
    let mut identity = Generated::new("zero-identity".to_string());
    let mut app = Generated::new(format!("zero-app-{}", built.schema.name));
    for (plugin, name) in [(&mut runtime, "zero-runtime"), (&mut app, "zero-app")] {
        let slug = plugin.slug.clone();
        let template = runtime_file(&format!("wp-plugin/{name}.php")).expect("embedded plugin template");
        plugin.built(
            format!("{slug}.php"),
            substitute(&String::from_utf8_lossy(template), &vars),
        );
        // Deleting the plugin in wp-admin runs uninstall.php: options and capabilities go, content stays.
        let uninstall = runtime_file(&format!("wp-plugin/{name}-uninstall.php")).expect("embedded uninstall template");
        plugin.embedded("uninstall.php", uninstall);
        plugin.built(
            "readme.txt",
            format!(
                "=== {slug} ===\nStable tag: {}\nLicense: GPL-2.0-or-later\n",
                env!("CARGO_PKG_VERSION")
            ),
        );
    }
    // The app plugin declares GPL-2.0-or-later like the runtime it extends; carry the text.
    if let Some(license) = runtime_file("Zero/LICENSE") {
        app.embedded("LICENSE", license);
    }
    app.built("zero/app/schema.php", schema_php.as_bytes());
    if let Some(wpml) = crate::wpml_config::render(&built.schema) {
        app.built("wpml-config.xml", wpml);
    }
    app.built("zero/app/functions.php", built.functions_php.as_bytes());
    read_sql_into(&mut app, migrations, "zero/app/migrations")?;
    let public = project.join("public");
    if public.is_dir() {
        read_dir_into(&mut app, &public, "public")?;
    }
    // The optional admin screens: only when the config opted in. The embedded tree is the
    // committed plugin (PHP, routes.js, notices, the built modules); its header carries the
    // same version placeholders as the generated plugins.
    let mut admin = built.schema.admin.then(|| Generated::new("zero-admin".to_string()));
    for (rel, bytes) in runtime_files::FILES {
        if let Some(rest) = rel.strip_prefix("Zero/") {
            runtime.embedded(format!("zero/{rest}"), bytes);
        } else if let Some(rest) = rel.strip_prefix("identity/") {
            identity.embedded(rest, bytes);
        } else if let (Some(admin), Some(rest)) = (admin.as_mut(), rel.strip_prefix("admin/")) {
            if rest == "zero-admin.php" {
                admin.built(rest, substitute(&String::from_utf8_lossy(bytes), &vars));
            } else {
                admin.embedded(rest, bytes);
            }
        }
    }
    Ok([runtime, identity, app].into_iter().chain(admin).collect())
}

/// Generated plugins are prepared in the same private tree as acquired dependencies.
pub(crate) fn emit_generated(project: &Path, migrations: &Path, plugins: &Path, built: &Built) -> std::io::Result<()> {
    for plugin in generated(project, migrations, built)? {
        plugin.write(&plugins.join(&plugin.slug))?;
    }
    Ok(())
}

pub(crate) fn plugin_vars(schema: &schema::Schema, schema_php: &str) -> Vec<(&'static str, String)> {
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
