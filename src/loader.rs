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

pub struct Program {
    pub modules: Vec<Rc<Module>>,
    /// (module id, specifier) → resolved module id.
    pub resolved: HashMap<(usize, String), usize>,
    pub entry: usize,
}

pub fn load(entry: &Path) -> Result<Program> {
    let mut program = Program {
        modules: Vec::new(),
        resolved: HashMap::new(),
        entry: 0,
    };
    let mut by_path: HashMap<PathBuf, usize> = HashMap::new();
    let entry = entry
        .canonicalize()
        .map_err(|e| Diag::new(Span::NONE, format!("{}: {e}", entry.display())))?;
    program.entry = load_module(&entry, &mut program, &mut by_path)?;
    Ok(program)
}

fn load_module(path: &Path, program: &mut Program, by_path: &mut HashMap<PathBuf, usize>) -> Result<usize> {
    if let Some(&id) = by_path.get(path) {
        return Ok(id);
    }
    let source = std::fs::read_to_string(path)
        .map_err(|e| Diag::new(Span::NONE, format!("can't read {}: {e}", path.display())))?;
    let file = diag::register_file(path, &source);
    let id = program.modules.len();
    by_path.insert(path.to_path_buf(), id);
    let body = parse(&source, path, file, id)?;
    let imports: Vec<(String, Span)> = body.iter().filter_map(import_source).collect();
    program.modules.push(Rc::new(Module {
        id,
        path: path.to_path_buf(),
        body,
    }));
    for (spec, span) in imports {
        if spec == ZERO_MODULE {
            continue;
        }
        let target = resolve(path, &spec, span)?;
        let target_id = load_module(&target, program, by_path)?;
        program.resolved.insert((id, spec), target_id);
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

fn parse(source: &str, path: &Path, file: u32, module: usize) -> Result<Vec<Stmt>> {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(path).unwrap_or_else(|_| SourceType::ts());
    if source_type.is_jsx() {
        return Err(Diag::new(
            Span { file, start: 0, end: 0 },
            "JSX files can't be part of a Zero config",
        ));
    }
    let ret = Parser::new(&allocator, source, source_type).parse();
    if let Some(err) = ret.diagnostics.errors().next() {
        let span = err
            .labels
            .first()
            .map(|l| Span {
                file,
                start: l.offset(),
                end: l.offset() + l.len(),
            })
            .unwrap_or(Span { file, start: 0, end: 0 });
        return Err(Diag::new(span, format!("syntax error: {}", err.message)));
    }
    Lowerer { file, module }.program(&ret.program)
}

fn resolve(from: &Path, spec: &str, span: Span) -> Result<PathBuf> {
    if !spec.starts_with("./") && !spec.starts_with("../") {
        return Err(Diag::new(
            span,
            format!("can't import \"{spec}\": npm packages aren't supported yet"),
        )
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
        if c.is_file() && matches!(c.extension().and_then(|e| e.to_str()), Some("ts" | "mts")) {
            return c.canonicalize().map_err(|e| Diag::new(span, e.to_string()));
        }
    }
    if base.is_file() {
        return Err(Diag::new(
            span,
            format!("can't import \"{spec}\": only TypeScript files can be imported"),
        ));
    }
    Err(Diag::new(span, format!("can't find \"{spec}\"")))
}
