//! Finds, parses, and lowers every module reachable from `zero.config.ts`.
//! Import rules live here: `"zero"`, relative TypeScript files, and nothing else.

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
    let (body, errors) = Lowerer { file, module }.program_diagnostics(&ret.program);
    diagnostics.extend(errors);
    Ok(body)
}

fn resolve(fs: &dyn Fs, from: &Path, spec: &str, span: Span) -> Result<PathBuf> {
    if !spec.starts_with("./") && !spec.starts_with("../") {
        return Err(Diag::new(
            span,
            format!("can't import \"{spec}\": npm packages aren't supported yet"),
        )
        .code(crate::diag::Code::NpmImport)
        .help("import from \"zero\" or from a relative .ts file; Zero compiles every imported line to PHP"));
    }
    let base = from.parent().expect("file has a directory").join(spec);
    let stripped = base.with_extension("");
    let candidates = [
        base.clone(),
        stripped.with_extension("ts"),
        stripped.with_extension("mts"),
        base.with_extension("ts"),
        base.join("index.ts"),
    ];
    // `./util.js` conventionally names `./util.ts` in TypeScript ESM.
    for c in candidates {
        if fs.is_file(&c) && matches!(c.extension().and_then(|e| e.to_str()), Some("ts" | "mts")) {
            return fs.canonicalize(&c).map_err(|e| Diag::new(span, e.to_string()));
        }
    }
    if fs.is_file(&base) {
        return Err(Diag::new(
            span,
            format!("can't import \"{spec}\": only TypeScript files can be imported"),
        ));
    }
    Err(Diag::new(span, format!("can't find \"{spec}\"")))
}
