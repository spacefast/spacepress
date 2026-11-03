//! Source-only publishing for hosts that own their compiler and WordPress platform.
//! No package installation, plugin downloads, user PHP, or subprocesses.

use crate::{
    commands::build,
    diag::{Diag, Span},
    loader::{self, Fs},
    pipeline,
};
use serde::{Deserialize, Serialize};
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    rc::Rc,
};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const SOURCE_PREFIX: &str = ".zero-source";
pub const OUTPUT_PREFIX: &str = ".zero-compiled";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sources {
    pub format: String,
    pub name: String,
    pub files: BTreeSet<String>,
    /// Relocatable canonical identities, including installed package symlinks.
    pub canonical: BTreeMap<String, String>,
}

fn failure(message: impl Into<String>) -> Diag {
    Diag::new(Span::NONE, message)
}
fn io(error: std::io::Error) -> Diag {
    failure(error.to_string())
}

fn relative(root: &Path, path: &Path) -> std::io::Result<String> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    let path = normalized
        .strip_prefix(root)
        .map_err(|_| std::io::Error::other("compiler input escapes project"))?;
    Ok(path.to_string_lossy().replace('\\', "/"))
}

struct Recording {
    root: PathBuf,
    files: RefCell<BTreeSet<String>>,
    canonical: RefCell<BTreeMap<String, String>>,
}

impl Fs for Recording {
    fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
        let real = self.canonicalize(path)?;
        let text = std::fs::read_to_string(&real)?;
        self.files.borrow_mut().insert(relative(&self.root, path)?);
        self.files.borrow_mut().insert(relative(&self.root, &real)?);
        Ok(text)
    }
    fn canonicalize(&self, path: &Path) -> std::io::Result<PathBuf> {
        let real = path.canonicalize()?;
        self.canonical
            .borrow_mut()
            .insert(relative(&self.root, path)?, relative(&self.root, &real)?);
        Ok(real)
    }
    fn is_file(&self, path: &Path) -> bool {
        self.canonicalize(path).is_ok_and(|p| p.is_file())
    }
    fn is_dir(&self, path: &Path) -> bool {
        self.canonicalize(path).is_ok_and(|p| p.is_dir())
    }
    fn exists(&self, path: &Path) -> bool {
        self.canonicalize(path).is_ok()
    }
}

/// Capture exactly the files read by loading AND compiling, including package.json resolution.
/// Public assets are copied separately. The destination must be new.
pub fn sources(project: &Path, destination: &Path) -> Result<Sources, Diag> {
    let project = project.canonicalize().map_err(io)?;
    let fs = Rc::new(Recording {
        root: project.clone(),
        files: RefCell::new(BTreeSet::new()),
        canonical: RefCell::new(BTreeMap::new()),
    });
    let program = loader::load_from(fs.clone(), &project.join("zero.config.ts")).map_err(|mut d| d.remove(0))?;
    let built = pipeline::build(
        &project,
        &program,
        || Ok(pipeline::Previous::none()),
        build::runtime_file,
    )?;
    if built.plugins.as_ref().is_some_and(|p| !p.plugins.is_empty()) {
        return Err(failure(
            "hosted apps cannot install WordPress plugins; the host provides the platform",
        ));
    }
    let captured = Sources {
        format: "zero.sources.v1".into(),
        name: built.schema.name.clone(),
        files: fs.files.borrow().clone(),
        canonical: fs.canonical.borrow().clone(),
    };
    std::fs::create_dir(destination).map_err(io)?;
    let source = destination.join(SOURCE_PREFIX);
    for path in &captured.files {
        safe_input(path)?;
        let target = source.join("project").join(path);
        std::fs::create_dir_all(target.parent().unwrap()).map_err(io)?;
        std::fs::copy(project.join(path), target).map_err(io)?;
    }
    copy_public(&project.join("public"), &destination.join("public"))?;
    std::fs::write(
        source.join("bundle.json"),
        serde_json::to_vec_pretty(&captured).map_err(|e| failure(e.to_string()))?,
    )
    .map_err(io)?;
    Ok(captured)
}

fn safe_input(path: &str) -> Result<(), Diag> {
    if path.is_empty()
        || path.contains('\\')
        || path.split('/').any(|s| s.is_empty() || s == "." || s == "..")
        || path.to_ascii_lowercase().ends_with(".php")
        || Path::new(path).is_absolute()
    {
        return Err(failure(format!("invalid hosted input: {path}")));
    }
    Ok(())
}

fn copy_public(from: &Path, to: &Path) -> Result<(), Diag> {
    if !from.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(to).map_err(io)?;
    for entry in std::fs::read_dir(from).map_err(io)? {
        let entry = entry.map_err(io)?;
        let name = entry.file_name();
        safe_input(&name.to_string_lossy())?;
        let kind = entry.file_type().map_err(io)?;
        if kind.is_dir() {
            copy_public(&entry.path(), &to.join(name))?;
        } else if kind.is_file() {
            std::fs::copy(entry.path(), to.join(name)).map_err(io)?;
        } else {
            return Err(failure("public assets cannot contain symlinks or special files"));
        }
    }
    Ok(())
}

struct CapturedFs {
    root: PathBuf,
    sources: Sources,
}
impl CapturedFs {
    fn key(&self, path: &Path) -> Option<String> {
        relative(&self.root, path).ok()
    }
}
impl Fs for CapturedFs {
    fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
        let real = self.canonicalize(path)?;
        std::fs::read_to_string(real)
    }
    fn canonicalize(&self, path: &Path) -> std::io::Result<PathBuf> {
        let key = self
            .key(path)
            .ok_or_else(|| std::io::Error::other("input escapes source bundle"))?;
        let canonical = self.sources.canonical.get(&key).unwrap_or(&key);
        if !self.sources.files.contains(canonical) && !self.is_dir(&self.root.join(canonical)) {
            return Err(std::io::Error::new(std::io::ErrorKind::NotFound, key));
        }
        Ok(self.root.join(canonical))
    }
    fn is_file(&self, path: &Path) -> bool {
        self.key(path).is_some_and(|p| self.sources.files.contains(&p))
    }
    fn is_dir(&self, path: &Path) -> bool {
        self.key(path)
            .is_some_and(|p| self.sources.files.iter().any(|f| f.starts_with(&(p.clone() + "/"))))
    }
    fn exists(&self, path: &Path) -> bool {
        self.is_file(path) || self.is_dir(path)
    }
}

/// Compile a captured source tree with a host-owned previous compiled tree as the migration baseline.
/// Output is exclusively generated code, never user-provided PHP or SQL. It must not exist yet.
pub fn compile(source: &Path, output: &Path, previous: Option<&Path>) -> Result<serde_json::Value, Diag> {
    let bytes = std::fs::read(source.join(SOURCE_PREFIX).join("bundle.json")).map_err(io)?;
    let sources: Sources = serde_json::from_slice(&bytes).map_err(|e| failure(e.to_string()))?;
    if sources.format != "zero.sources.v1"
        || sources.name.is_empty()
        || !sources
            .name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err(failure("invalid source bundle format or app name"));
    }
    for path in sources
        .files
        .iter()
        .chain(sources.canonical.keys())
        .chain(sources.canonical.values())
    {
        safe_input(path)?;
    }
    let name = sources.name.clone();
    let root = source.join(SOURCE_PREFIX).join("project");
    let fs = Rc::new(CapturedFs {
        root: root.clone(),
        sources,
    });
    let program = loader::load_from(fs, &root.join("zero.config.ts")).map_err(|mut d| d.remove(0))?;
    let snapshot = previous
        .map(|p| {
            std::fs::read(p.join("snapshot.json"))
                .map_err(io)
                .and_then(|b| serde_json::from_slice(&b).map_err(|e| failure(e.to_string())))
        })
        .transpose()?;
    let previous_migrations = previous.map(|p| p.join("migrations"));
    let names: Vec<String> = match &previous_migrations {
        Some(p) => std::fs::read_dir(p)
            .map_err(io)?
            .map(|e| e.map(|e| e.file_name().to_string_lossy().into_owned()))
            .collect::<Result<_, _>>()
            .map_err(io)?,
        None => Vec::new(),
    };
    let built = pipeline::build(
        Path::new(&name),
        &program,
        || pipeline::Previous::from_project(snapshot, names.iter().map(String::as_str)),
        build::runtime_file,
    )?;
    if built.plugins.as_ref().is_some_and(|p| !p.plugins.is_empty()) {
        return Err(failure("hosted apps cannot install WordPress plugins"));
    }
    std::fs::create_dir(output).map_err(io)?;
    let migrations = output.join("migrations");
    std::fs::create_dir(&migrations).map_err(io)?;
    if let Some(previous) = previous_migrations {
        for name in &names {
            std::fs::copy(previous.join(name), migrations.join(name)).map_err(io)?;
        }
    }
    for (name, sql) in &built.migrations {
        std::fs::write(migrations.join(name), sql).map_err(io)?;
    }
    std::fs::write(
        output.join("snapshot.json"),
        serde_json::to_vec(&built.snapshot).map_err(|e| failure(e.to_string()))?,
    )
    .map_err(io)?;
    build::emit_generated(source, &migrations, &output.join("plugins"), &built).map_err(io)?;
    let requirements: BTreeMap<_, _> = crate::platform::plugins(built.schema.locales.is_some())
        .into_iter()
        .map(|p| (p.slug, p.version))
        .collect();
    let manifest = serde_json::json!({"format":"zero.hosted.v1", "compiler":VERSION, "app":built.schema.name,
        "wordpress":crate::platform::WORDPRESS, "php":crate::platform::PHP, "requires":requirements});
    std::fs::write(
        output.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .map_err(io)?;
    Ok(manifest)
}

pub(crate) fn sources_cli(args: &[String]) -> std::process::ExitCode {
    let result = match args {
        [project, flag, output] if flag == "--out" => sources(Path::new(project), Path::new(output)).map(|_| ()),
        _ => Err(failure("usage: zero sources <project> --out <new-directory>")),
    };
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{}", e.message);
            std::process::ExitCode::FAILURE
        }
    }
}
