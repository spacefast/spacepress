//! Finds, parses, and lowers every module reachable from `zero.config.ts`.
//! Resolves local sources and installed source packages; never installs or executes package code.

use crate::diag::{self, Diag, Result, Span};
use crate::ir::{Module, Stmt};
use crate::lower::Lowerer;
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;

pub const ZERO_MODULE: &str = "zero";

/// Where sources come from: the project directory for the CLI, memory for the browser build. Paths
/// are absolute either way, so diagnostics and module identity work the same.
pub trait Fs {
    fn read_to_string(&self, path: &Path) -> std::io::Result<String>;
    fn is_file(&self, path: &Path) -> bool;
    fn is_dir(&self, path: &Path) -> bool;
    /// Whether anything at all (a file, a directory, a dangling link) is at `path`.
    fn exists(&self, path: &Path) -> bool;
    fn canonicalize(&self, path: &Path) -> std::io::Result<PathBuf>;
}

/// The real file system.
pub struct Disk;

impl Fs for Disk {
    fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
        std::fs::read_to_string(path)
    }
    fn is_file(&self, path: &Path) -> bool {
        path.is_file()
    }
    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }
    fn exists(&self, path: &Path) -> bool {
        std::fs::symlink_metadata(path).is_ok()
    }
    fn canonicalize(&self, path: &Path) -> std::io::Result<PathBuf> {
        path.canonicalize()
    }
}

pub struct Program {
    pub modules: Vec<Rc<Module>>,
    /// (module id, specifier) → resolved module id.
    pub resolved: HashMap<(usize, String), usize>,
    pub entry: usize,
    /// The source of these modules; later passes that look beside them (sync directories) ask it.
    pub fs: Rc<dyn Fs>,
}

pub fn load(entry: &Path) -> Result<Program> {
    load_all(entry).map_err(|diagnostics| diagnostics.into_iter().next().expect("failed load has diagnostics"))
}

pub fn load_all(entry: &Path) -> std::result::Result<Program, Vec<Diag>> {
    load_from(Rc::new(Disk), entry)
}

pub fn load_from(fs: Rc<dyn Fs>, entry: &Path) -> std::result::Result<Program, Vec<Diag>> {
    let mut program = Program {
        modules: Vec::new(),
        resolved: HashMap::new(),
        entry: 0,
        fs: fs.clone(),
    };
    let mut by_path: HashMap<PathBuf, usize> = HashMap::new();
    let entry = fs
        .canonicalize(entry)
        .map_err(|e| vec![Diag::new(Span::NONE, format!("{}: {e}", entry.display())).code(diag::Code::Import)])?;
    let mut diagnostics = Vec::new();
    match load_module(&*fs, &entry, &mut program, &mut by_path, &mut diagnostics) {
        Ok(id) => program.entry = id,
        Err(d) => diagnostics.push(d.phase(diag::Code::Import)),
    }
    if diagnostics.is_empty() {
        Ok(program)
    } else {
        Err(diagnostics)
    }
}

fn load_module(
    fs: &dyn Fs,
    path: &Path,
    program: &mut Program,
    by_path: &mut HashMap<PathBuf, usize>,
    diagnostics: &mut Vec<Diag>,
) -> Result<usize> {
    if let Some(&id) = by_path.get(path) {
        return Ok(id);
    }
    let source = fs
        .read_to_string(path)
        .map_err(|e| Diag::new(Span::NONE, format!("can't read {}: {e}", path.display())))?;
    let file = diag::register_file(path, &source);
    let id = program.modules.len();
    by_path.insert(path.to_path_buf(), id);
    let body = parse(&source, path, file, id, diagnostics)?;
    let imports: Vec<(String, Span)> = body.iter().filter_map(import_source).collect();
    program.modules.push(Rc::new(Module {
        id,
        file,
        path: path.to_path_buf(),
        body,
    }));
    for (spec, span) in imports {
        if spec == ZERO_MODULE {
            continue;
        }
        match resolve(fs, path, &spec, span).and_then(|target| load_module(fs, &target, program, by_path, diagnostics))
        {
            Ok(target_id) => {
                program.resolved.insert((id, spec), target_id);
            }
            Err(d) => diagnostics.push(d.phase(diag::Code::Import)),
        }
    }
    Ok(id)
}

fn import_source(s: &Stmt) -> Option<(String, Span)> {
    match s {
        Stmt::Import {
            source,
            specs,
            type_only,
            span,
        } => {
            // Type-only imports are erased; they never load code.
            if *type_only || (!specs.is_empty() && specs.iter().all(|s| s.type_only)) {
                if source.starts_with('.') {
                    Some((source.clone(), *span))
                } else {
                    None
                }
            } else {
                Some((source.clone(), *span))
            }
        }
        Stmt::ExportNames {
            from: Some(from), span, ..
        }
        | Stmt::ExportAll { from, span } => Some((from.clone(), *span)),
        _ => None,
    }
}

fn parse(source: &str, path: &Path, file: u32, module: usize, diagnostics: &mut Vec<Diag>) -> Result<Vec<Stmt>> {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(path).unwrap_or_else(|_| SourceType::ts());
    if source_type.is_jsx() {
        return Err(Diag::new(
            Span { file, start: 0, end: 0 },
            "JSX files can't be part of a Zero config",
        ));
    }
    let ret = Parser::new(&allocator, source, source_type).parse();
    let mut syntax_failed = false;
    for err in ret.diagnostics.errors() {
        syntax_failed = true;
        let span = err
            .labels
            .first()
            .map(|l| Span {
                file,
                start: l.offset(),
                end: l.offset() + l.len(),
            })
            .unwrap_or(Span { file, start: 0, end: 0 });
        diagnostics.push(Diag::new(span, format!("syntax error: {}", err.message)).code(diag::Code::Syntax));
    }
    if syntax_failed {
        return Ok(Vec::new());
    }
    let (body, errors) = Lowerer {
        file,
        module,
        class_context: std::cell::Cell::new(false),
        super_call: std::cell::Cell::new(false),
    }
    .program_diagnostics(&ret.program);
    diagnostics.extend(errors);
    Ok(body)
}

fn resolve(fs: &dyn Fs, from: &Path, spec: &str, span: Span) -> Result<PathBuf> {
    if !spec.starts_with("./") && !spec.starts_with("../") {
        return resolve_package(fs, from, spec, span);
    }
    let base = from.parent().expect("file has a directory").join(spec);
    resolve_source(fs, &base, spec, span)
}

fn resolve_source(fs: &dyn Fs, base: &Path, spec: &str, span: Span) -> Result<PathBuf> {
    let stripped = base.with_extension("");
    // `./util.js` conventionally names `./util.ts` in TypeScript ESM.
    let mut candidates = Vec::new();
    if matches!(base.extension().and_then(|e| e.to_str()), Some("js" | "mjs")) {
        candidates.push(stripped.with_extension("ts"));
        candidates.push(stripped.with_extension("mts"));
    }
    candidates.extend([
        base.to_path_buf(),
        base.with_extension("ts"),
        base.with_extension("mts"),
        base.with_extension("mjs"),
        base.with_extension("js"),
        base.join("index.ts"),
        base.join("index.mts"),
        base.join("index.mjs"),
        base.join("index.js"),
    ]);
    for c in candidates {
        if fs.is_file(&c)
            && !c.to_string_lossy().ends_with(".d.ts")
            && matches!(
                c.extension().and_then(|e| e.to_str()),
                Some("ts" | "mts" | "js" | "mjs")
            )
        {
            return fs.canonicalize(&c).map_err(|e| Diag::new(span, e.to_string()));
        }
    }
    if fs.is_file(base) {
        return Err(Diag::new(
            span,
            format!("can't import \"{spec}\": expected TypeScript or ESM JavaScript source"),
        ));
    }
    Err(Diag::new(span, format!("can't find \"{spec}\"")))
}

fn package_error(spec: &str, span: Span, reason: &str) -> Diag {
    Diag::new(span, format!("can't import \"{spec}\": {reason}"))
        .code(diag::Code::NpmImport)
        .help("install a source package locally; its TypeScript or ESM source must fit Zero's PHP compiler subset")
}

fn resolve_package(fs: &dyn Fs, from: &Path, spec: &str, span: Span) -> Result<PathBuf> {
    let parts: Vec<_> = spec.split('/').collect();
    let count = if spec.starts_with('@') { 2 } else { 1 };
    if parts.len() < count
        || parts.iter().any(|p| p.is_empty() || *p == "." || *p == "..")
        || spec.contains([':', '\\', '%', '#', '?', '*'])
        || (spec.starts_with('@') && parts[0].len() == 1)
    {
        return Err(package_error(
            spec,
            span,
            "unsupported package specifier (Node built-ins and package aliases are unavailable)",
        ));
    }
    let name = parts[..count].join("/");
    let subpath = if parts.len() == count {
        ".".to_string()
    } else {
        format!("./{}", parts[count..].join("/"))
    };
    let package = from
        .parent()
        .into_iter()
        .flat_map(Path::ancestors)
        .filter(|dir| dir.file_name().is_none_or(|name| name != "node_modules"))
        .map(|dir| dir.join("node_modules").join(&name))
        .find(|dir| fs.is_file(&dir.join("package.json")))
        .ok_or_else(|| package_error(spec, span, "package is not installed in node_modules"))?;
    let source = fs
        .read_to_string(&package.join("package.json"))
        .map_err(|e| package_error(spec, span, &format!("can't read package.json: {e}")))?;
    let manifest: serde_json::Value =
        serde_json::from_str(&source).map_err(|e| package_error(spec, span, &format!("invalid package.json: {e}")))?;
    let module_package = manifest.get("type").and_then(|v| v.as_str()) == Some("module");
    let target = if let Some(exports) = manifest.get("exports") {
        let entry = if exports
            .as_object()
            .is_some_and(|map| map.keys().any(|key| key.starts_with('.')))
        {
            exports.get(&subpath)
        } else if subpath == "." {
            Some(exports)
        } else {
            None
        };
        let target = entry.and_then(package_export).ok_or_else(|| {
            package_error(
                spec,
                span,
                "no exact import/default source export (patterns and require-only exports are unsupported)",
            )
        })?;
        if !target.starts_with("./") {
            return Err(package_error(spec, span, "package export targets must start with ./"));
        }
        target.to_string()
    } else if subpath != "." {
        subpath
    } else if let Some(module) = manifest.get("module").and_then(|v| v.as_str()) {
        module.to_string()
    } else if module_package
        || manifest
            .get("main")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s.ends_with(".mjs") || s.ends_with(".ts") || s.ends_with(".mts"))
    {
        manifest
            .get("main")
            .and_then(|v| v.as_str())
            .unwrap_or("./index.js")
            .to_string()
    } else {
        return Err(package_error(spec, span, "CommonJS packages need an ESM source export"));
    };
    if target.starts_with('/')
        || target.contains(['\\', '%', '#', '?', '*'])
        || target.split('/').any(|part| part == ".." || part == "node_modules")
    {
        return Err(package_error(
            spec,
            span,
            "package source target must stay inside its package",
        ));
    }
    let path = package.join(&target);
    if !fs.is_file(&path)
        || target.ends_with(".d.ts")
        || target.ends_with(".d.mts")
        || !matches!(
            path.extension().and_then(|extension| extension.to_str()),
            Some("ts" | "mts" | "js" | "mjs")
        )
    {
        return Err(package_error(
            spec,
            span,
            "expected TypeScript or ESM JavaScript source at the exact package target",
        ));
    }
    let resolved = fs
        .canonicalize(&path)
        .map_err(|e| package_error(spec, span, &e.to_string()))?;
    let package = fs
        .canonicalize(&package)
        .map_err(|e| package_error(spec, span, &e.to_string()))?;
    if !resolved.starts_with(package) {
        return Err(package_error(spec, span, "package source target escapes its package"));
    }
    if resolved.extension().is_some_and(|extension| extension == "js")
        && !module_package
        && manifest.get("module").and_then(|v| v.as_str()) != Some(target.as_str())
    {
        return Err(package_error(
            spec,
            span,
            ".js package exports require type: module; use .mjs for ESM",
        ));
    }
    Ok(resolved)
}

fn package_export(value: &serde_json::Value) -> Option<&str> {
    if let Some(target) = value.as_str() {
        return Some(target);
    }
    let (_, target) = value
        .as_object()?
        .iter()
        .find(|(condition, _)| *condition == "import" || *condition == "default")?;
    package_export(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory(files: &[(&str, &str)]) -> crate::wasm::Memory {
        crate::wasm::Memory::new(
            files
                .iter()
                .map(|(path, source)| (PathBuf::from(path), source.to_string()))
                .collect(),
        )
    }

    #[test]
    fn installed_sources_follow_nearest_packages_exact_exports_and_relative_ts_imports() {
        let fs = memory(&[
            (
                "/p/zero.config.ts",
                "import { value } from '@demo/helpers'; import { other } from '@demo/helpers/extra';",
            ),
            (
                "/p/node_modules/@demo/helpers/package.json",
                r#"{"exports":{".":{"types":"./absent.d.ts","import":{"import":"./src/index.ts","default":"./absent.ts"}},"./extra":"./src/extra.mjs"}}"#,
            ),
            (
                "/p/node_modules/@demo/helpers/src/index.ts",
                "export { value } from './value.js'; import { value as dependency } from 'shared';",
            ),
            ("/p/node_modules/@demo/helpers/src/value.ts", "export const value = 3;"),
            ("/p/node_modules/@demo/helpers/src/extra.mjs", "export const other = 4;"),
            (
                "/p/node_modules/@demo/helpers/node_modules/shared/package.json",
                r#"{"type":"module","main":"./index.js"}"#,
            ),
            (
                "/p/node_modules/@demo/helpers/node_modules/shared/index.js",
                "export const value = 5;",
            ),
            ("/p/node_modules/shared/package.json", r#"{"module":"./index.mjs"}"#),
            ("/p/node_modules/shared/index.mjs", "export const value = 9;"),
        ]);
        let program = load_from(Rc::new(fs), Path::new("/p/zero.config.ts")).unwrap_or_else(|ds| panic!("{ds:?}"));
        let paths: Vec<_> = program
            .modules
            .iter()
            .map(|module| module.path.to_string_lossy().into_owned())
            .collect();
        assert_eq!(paths.len(), 5, "{paths:?}");
        assert!(paths.contains(&"/p/node_modules/@demo/helpers/src/value.ts".to_string()));
        assert!(paths.contains(&"/p/node_modules/@demo/helpers/node_modules/shared/index.js".to_string()));
        assert_eq!(
            resolve(&*program.fs, Path::new("/p/zero.config.ts"), "shared", Span::NONE).unwrap(),
            PathBuf::from("/p/node_modules/shared/index.mjs")
        );
    }

    #[test]
    fn package_exports_refuse_unavailable_formats_and_escaping_targets_without_fallback() {
        for (manifest, spec, reason) in [
            (
                r#"{"exports":{"import":null,"default":"./source.ts"}}"#,
                "pkg",
                "no exact import/default",
            ),
            (
                r#"{"exports":{"require":"./source.ts"}}"#,
                "pkg",
                "no exact import/default",
            ),
            (r#"{"exports":"./../outside.ts"}"#, "pkg", "must stay inside"),
            (
                r#"{"exports":{"./*":"./source.ts"}}"#,
                "pkg/private",
                "no exact import/default",
            ),
            (r#"{"main":"./source.js"}"#, "pkg", "CommonJS"),
            (r#"{"exports":"./source.js"}"#, "pkg", "require type: module"),
            (r#"{"exports":"./source.d.ts"}"#, "pkg", "expected TypeScript or ESM"),
            (
                r#"{"exports":"./source.ts"}"#,
                "node:fs",
                "unsupported package specifier",
            ),
        ] {
            let fs = memory(&[
                ("/p/zero.config.ts", ""),
                ("/p/node_modules/pkg/package.json", manifest),
                ("/p/node_modules/pkg/source.ts", "export const value = 1;"),
                ("/p/node_modules/pkg/source.js", "module.exports = 1;"),
                ("/p/node_modules/pkg/source.d.ts", "export declare const value: number;"),
            ]);
            let error = resolve(&fs, Path::new("/p/zero.config.ts"), spec, Span::NONE).unwrap_err();
            assert!(error.message.contains(reason), "{manifest}: {error:?}");
        }
    }

    #[cfg(all(unix, feature = "cli"))]
    #[test]
    fn package_exports_cannot_follow_a_symlink_outside_the_package() {
        let temp = tempfile::tempdir().unwrap();
        let package = temp.path().join("node_modules/pkg");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(temp.path().join("outside.ts"), "export const value = 1;").unwrap();
        std::fs::write(package.join("package.json"), r#"{"exports":"./source.ts"}"#).unwrap();
        std::os::unix::fs::symlink(temp.path().join("outside.ts"), package.join("source.ts")).unwrap();
        let error = resolve(&Disk, &temp.path().join("zero.config.ts"), "pkg", Span::NONE).unwrap_err();
        assert!(error.message.contains("escapes its package"), "{error:?}");
    }
}
