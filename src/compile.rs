//! Compiles hooks, actions, and the helpers they call into PHP.
//!
//! Each function is type-checked against what the config declared (the schema
//! gives hooks their row types) and lowered to native PHP wherever the types
//! make it safe. Where JavaScript and PHP genuinely differ (truthiness, `+` on
//! unknown operands, string indexing, sort order) the output calls a `Js::`
//! helper. Where neither is sound, the build fails with a location and a fix.

use crate::diag::{Diag, Result, Span, suggest};
use crate::eval::{Evaluator, GLOBALS, to_json};
use crate::extract::{Extracted, Root, Slot};
use crate::ir::*;
use crate::num::php_number;
use crate::schema::{ColType, Column, HookKind, Owner, RelKind, Schema};
use crate::types::{self, Builder, BuilderKind, JSON_TYPES, Ty};
use crate::value::*;
use indexmap::IndexMap;
use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::rc::Rc;

pub fn php_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for c in s.chars() {
        match c {
            '\'' => out.push_str("\\'"),
            '\\' => out.push_str("\\\\"),
            c => out.push(c),
        }
    }
    out.push('\'');
    out
}

/// PHP literal for a JSON value (used for constants captured by hooks).
pub fn php_json(v: &serde_json::Value) -> String {
    use serde_json::Value as J;
    match v {
        J::Null => "null".into(),
        J::Bool(b) => b.to_string(),
        J::Number(n) => match n.as_i64() {
            Some(i) => i.to_string(),
            None => php_number(n.as_f64().unwrap_or(f64::NAN)),
        },
        J::String(s) => php_str(s),
        J::Array(items) => format!("[{}]", items.iter().map(php_json).collect::<Vec<_>>().join(", ")),
        J::Object(map) => format!(
            "[{}]",
            map.iter()
                .map(|(k, v)| format!("{} => {}", php_str(k), php_json(v)))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    }
}

fn err<T>(span: Span, msg: impl Into<String>) -> Result<T> {
    Err(Diag::new(span, msg))
}

fn err_help<T>(span: Span, msg: impl Into<String>, help: impl Into<String>) -> Result<T> {
    Err(Diag::new(span, msg).help(help))
}

fn validate_captured_data(v: &Value, span: Span, seen: &mut HashSet<usize>) -> Result<()> {
    match v {
        Value::Array(a) => {
            if !seen.insert(Rc::as_ptr(a) as usize) {
                return err_help(
                    span,
                    "captured data cannot contain cycles",
                    "capture plain data without circular references",
                );
            }
            for value in a.borrow().iter() {
                validate_captured_data(value, span, seen)?;
            }
            seen.remove(&(Rc::as_ptr(a) as usize));
            Ok(())
        }
        Value::Object(o) => {
            if !seen.insert(Rc::as_ptr(o) as usize) {
                return err_help(
                    span,
                    "captured data cannot contain cycles",
                    "capture plain data without circular references",
                );
            }
            for value in o.borrow().values() {
                validate_captured_data(value, span, seen)?;
            }
            seen.remove(&(Rc::as_ptr(o) as usize));
            Ok(())
        }
        Value::Env(_) | Value::Builtin(Builtin::Env | Builtin::Once | Builtin::Jobs) => err_help(
            span,
            "not implemented until lane D",
            "runtime enqueue/once/env calls become available in lane D",
        ),
        Value::Null | Value::Undef | Value::Bool(_) | Value::Num(_) | Value::Str(_) => Ok(()),
        _ => err_help(
            span,
            format!("captured data contains {}, which can't be used in PHP", v.describe()),
            "capture plain data instead",
        ),
    }
}

/// A compiled expression: PHP source, its type, and whether it's a plain variable/property path.
#[derive(Clone, Debug)]
struct Out {
    php: String,
    ty: Ty,
    /// Assignable PHP place (`$x`, `$x['k']`) rooted at a local.
    place: Option<String>,
    /// Precedence: true when `php` is atomic (no parens needed).
    atomic: bool,
    /// Set when the value is a compiled helper: call it by name.
    helper: Option<String>,
}

impl Out {
    fn new(php: impl Into<String>, ty: Ty) -> Out {
        Out {
            php: php.into(),
            ty,
            place: None,
            atomic: false,
            helper: None,
        }
    }

    fn atom(php: impl Into<String>, ty: Ty) -> Out {
        Out {
            php: php.into(),
            ty,
            place: None,
            atomic: true,
            helper: None,
        }
    }

    fn checked_str(self, arg: &Out, span: Span) -> Result<Out> {
        if arg.ty.is_str() {
            Ok(self)
        } else {
            err(span, format!("this needs a string, not {}", arg.ty.describe()))
        }
    }

    fn wrapped(&self) -> String {
        if self.atomic {
            self.php.clone()
        } else {
            format!("({})", self.php)
        }
    }
}

#[derive(Clone)]
struct Local {
    php: String,
    ty: Ty,
    mutable: bool,
}

/// What an identifier in compiled code refers to, resolved through the closure's captured scope.
enum Resolved {
    Local(Local),
    Value(Value, Binding),
    Global(&'static str),
}

struct FnCtx {
    scopes: Vec<HashMap<String, Local>>,
    is_async: bool,
    ret: Option<Ty>,
    /// Inferred return types (when no annotation).
    returns: Vec<Ty>,
    /// Expressions proven not to complete by their compiled type.
    diverging: HashSet<Span>,
    /// Switch statements whose cases cover the compiled discriminant type.
    exhaustive_switches: HashSet<Span>,
    /// The closure whose captured environment resolves free names.
    env: Rc<Scope>,
    module: usize,
    /// Parameter names that need `&` because the function mutates them.
    by_ref: HashSet<String>,
    /// Locals declared so far in this PHP function (for closure `use` lists).
    declared: Vec<String>,
    /// Inside a nested closure: names from the enclosing function it uses.
    captures: Option<Vec<(String, bool)>>,
    outer: Option<Box<FnCtx>>,
    tmp: usize,
    /// Switches between the current statement and the nearest loop (PHP counts them for `continue`).
    switch_depth: usize,
    /// Access rules can't query (§1.6): `db` is rejected inside them and their closures.
    no_db: bool,
    /// Set while compiling an access rule's own body: (collection table, op). Its returns are
    /// `true`/`false` or a filter literal checked against that collection.
    access: Option<(Option<String>, String)>,
}

pub struct Compiler<'a, 'p> {
    pub schema: &'a Schema,
    ev: &'a mut Evaluator<'p>,
    collections: &'a [Rc<CollectionVal>],
    type_aliases: HashMap<(usize, String), (Vec<String>, TyAnn)>,
    /// Compiled module-level helpers, separated by whether database access is forbidden.
    helpers: HashMap<(usize, bool), String>,
    helper_types: HashMap<usize, Ty>,
    used_names: HashSet<String>,
    pending: Vec<(Rc<Closure>, String, Option<Vec<Ty>>)>,
    pub output: String,
    fx: Option<FnCtx>,
    /// Inferred result type of each action handler (for the typed client).
    pub action_results: HashMap<String, Ty>,
}

fn closure_key(c: &Rc<Closure>) -> usize {
    Rc::as_ptr(&c.func) as *const () as usize
}

impl<'a, 'p> Compiler<'a, 'p> {
    pub fn new(
        schema: &'a Schema,
        ev: &'a mut Evaluator<'p>,
        ext: &'a Extracted,
        program: &crate::loader::Program,
    ) -> Self {
        let mut type_aliases = HashMap::new();
        for m in &program.modules {
            collect_aliases(&m.body, m.id, &mut type_aliases);
        }
        Compiler {
            schema,
            ev,
            collections: &ext.collections,
            type_aliases,
            helpers: HashMap::new(),
            helper_types: HashMap::new(),
            used_names: HashSet::new(),
            pending: Vec::new(),
            output: String::new(),
            fx: None,
            action_results: HashMap::new(),
        }
    }

    fn fx(&mut self) -> &mut FnCtx {
        self.fx.as_mut().expect("inside a function")
    }

    fn unique_name(&mut self, base: &str) -> String {
        let mut name: String = base
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' })
            .collect();
        if self.used_names.contains(&name) {
            let mut i = 2;
            while self.used_names.contains(&format!("{name}_{i}")) {
                i += 1;
            }
            name = format!("{name}_{i}");
        }
        self.used_names.insert(name.clone());
        name
    }

    /// Resolves all JSON annotations before any function is compiled, including nested handler inputs.
    pub fn resolve_json_types(&mut self) -> Result<()> {
        fn collect<'a>(columns: &'a IndexMap<String, Column>, out: &mut Vec<&'a Column>) {
            for col in columns.values() {
                if col.ts_type.is_some() {
                    out.push(col);
                }
                if let Some(fields) = &col.fields {
                    collect(fields, out);
                }
                if let Some(layouts) = &col.layouts {
                    for fields in layouts.values() {
                        collect(fields, out);
                    }
                }
            }
        }
        JSON_TYPES.with(|m| m.borrow_mut().clear());
        let mut annotated = Vec::new();
        for collection in self.schema.collections.values() {
            collect(&collection.columns, &mut annotated);
        }
        for global in self.schema.globals.values() {
            collect(&global.fields, &mut annotated);
        }
        for action in self.schema.actions.values() {
            collect(&action.input, &mut annotated);
        }
        for job in self.schema.jobs.values() {
            collect(&job.input, &mut annotated);
        }
        for col in annotated {
            let (ann, module) = col.ts_type.as_ref().expect("annotated column");
            let ty = self.resolve_ann(ann, *module, &HashMap::new())?;
            JSON_TYPES.with(|m| m.borrow_mut().insert(col as *const Column as usize, ty));
        }
        Ok(())
    }

    /// Compiles every root (hooks, actions, defaults) and returns slot → PHP function name.
    pub fn compile_roots(&mut self, roots: &[Root]) -> Result<Vec<(Slot, String)>> {
        let mut out = Vec::new();
        for root in roots {
            let params = self.root_params(&root.slot);
            let name = self.unique_name(&root.name);
            // A hook given by reference (`afterCreate: restock`) reuses the helper's compiled body.
            let key = closure_key(&root.closure);
            let no_db = matches!(root.slot, Slot::Access { .. } | Slot::FieldAccess { .. });
            self.compile_function(&root.closure, &name, Some(params), Some(&root.slot), no_db)?;
            if let Slot::ActionHandler { action } = &root.slot
                && let Some(Ty::Fn(_, ret)) = self.helper_types.get(&key)
            {
                let ret = match &**ret {
                    Ty::Promise(t) => (**t).clone(),
                    t => t.clone(),
                };
                self.action_results.insert(action.clone(), ret);
            }
            self.helpers.entry((key, no_db)).or_insert_with(|| name.clone());
            out.push((root.slot.clone(), name));
        }
        while let Some((closure, name, params)) = self.pending.pop() {
            self.compile_function(&closure, &name, params, None, false)?;
        }
        Ok(out)
    }

    fn root_params(&self, slot: &Slot) -> Vec<Ty> {
        let ctx = types::hook_ctx();
        match slot {
            Slot::Hook { table, kind } => {
                let row = types::row(self.schema, table);
                match kind {
                    HookKind::BeforeCreate => vec![types::insert(self.schema, table), ctx],
                    HookKind::BeforeUpdate => vec![types::partial(types::insert(self.schema, table)), row, ctx],
                    HookKind::AfterUpdate => vec![row.clone(), row, ctx],
                    _ => vec![row, ctx],
                }
            }
            Slot::JobHandler { job } => vec![
                types::action_input(&self.schema.jobs[job].input, &types::json_ty),
                types::job_ctx(),
            ],
            Slot::FieldAccess { .. } => vec![types::field_access_ctx()],
            Slot::ActionHandler { action } => vec![
                types::action_input(&self.schema.actions[action].input, &types::json_ty),
                ctx,
            ],
            Slot::Access { owner, op } => {
                let data = match owner {
                    Owner::Collection(t) if op == "create" => types::partial(types::insert(self.schema, t)),
                    Owner::Collection(t) if op == "update" => types::partial(types::insert(self.schema, t)),
                    Owner::Global(g) if op == "update" => types::partial(types::global_row(&self.schema.globals[g])),
                    _ => Ty::Map(Box::new(Ty::Unknown)),
                };
                vec![types::access_ctx(data)]
            }
            Slot::Validate { at } => {
                let col = self.schema.column_at(at);
                vec![types::col_base(col, &types::json_ty, false), types::validate_ctx()]
            }
            Slot::Default { .. } | Slot::OnUpdate { .. } => vec![],
        }
    }

    fn compile_function(
        &mut self,
        closure: &Rc<Closure>,
        name: &str,
        params: Option<Vec<Ty>>,
        slot: Option<&Slot>,
        no_db: bool,
    ) -> Result<()> {
        let f = closure.func.clone();
        if matches!(slot, Some(Slot::FieldAccess { .. })) && f.is_async {
            return err_help(
                f.span,
                "field rules must be synchronous",
                "return a boolean without async/await",
            );
        }
        let mut fx = FnCtx {
            scopes: vec![HashMap::new()],
            is_async: f.is_async,
            ret: None,
            returns: Vec::new(),
            diverging: HashSet::new(),
            exhaustive_switches: HashSet::new(),
            env: closure.env.clone(),
            module: f.module,
            by_ref: HashSet::new(),
            declared: Vec::new(),
            captures: None,
            outer: None,
            tmp: 0,
            switch_depth: 0,
            no_db,
            access: match slot {
                Some(Slot::FieldAccess { .. }) => Some((None, "field".into())),
                Some(Slot::Access { owner, op }) => Some((
                    match owner {
                        Owner::Collection(t) => Some(t.clone()),
                        _ => None,
                    },
                    op.clone(),
                )),
                _ => None,
            },
        };
        let generics: HashMap<String, Ty> = f.type_params.iter().map(|t| (t.clone(), Ty::Unknown)).collect();
        let mut param_tys = Vec::new();
        for (i, p) in f.params.iter().enumerate() {
            let declared = match &p.ann {
                Some(a) => Some(self.resolve_ann(a, f.module, &generics)?),
                None => None,
            };
            let given = params.as_ref().and_then(|ps| ps.get(i)).cloned();
            let t = match (declared, given) {
                (Some(d), Some(g)) => {
                    if !assignable(&g, &d) {
                        return err(
                            p.span,
                            format!(
                                "this parameter is declared as {}, but it receives {}",
                                d.describe(),
                                g.describe()
                            ),
                        );
                    }
                    d
                }
                (Some(d), None) => d,
                (None, Some(g)) => widen_literal_array(&g),
                (None, None) => {
                    return err_help(
                        p.span,
                        "this parameter needs a type",
                        "annotate it, e.g. `(item: Item)`; Zero compiles by type",
                    );
                }
            };
            let t = if p.optional || p.default.is_some() {
                t.nullable()
            } else {
                t
            };
            param_tys.push(t);
        }
        if let Some(r) = &f.ret {
            let t = self.resolve_ann(r, f.module, &generics)?;
            fx.ret = Some(match t {
                Ty::Promise(inner) if f.is_async => *inner,
                t => t,
            });
        }
        if let Some(ps) = &params
            && ps.len()
                < f.params
                    .iter()
                    .filter(|p| !p.optional && p.default.is_none() && !p.rest)
                    .count()
        {
            return err(
                f.span,
                format!(
                    "this function takes {} parameters, but Zero calls it with {}",
                    f.params.len(),
                    ps.len()
                ),
            );
        }
        fx.by_ref = mutated_params(&f);
        // Recursive calls need the signature before the body is compiled.
        if let Some(ret) = &fx.ret {
            let ret = if f.is_async {
                Ty::Promise(Box::new(ret.clone()))
            } else {
                ret.clone()
            };
            self.helper_types
                .insert(closure_key(closure), Ty::Fn(param_tys.clone(), Box::new(ret)));
        }
        check_aliasing(&f)?;
        let saved = self.fx.replace(fx);
        let result = self.compile_function_body(&f, name, &param_tys, slot);
        let fx = std::mem::replace(&mut self.fx, saved).expect("function context");
        let (params_php, body) = result?;
        let ret_ty = fx.ret.clone().unwrap_or_else(|| Ty::union(fx.returns.clone()));
        self.helper_types.insert(
            closure_key(closure),
            Ty::Fn(
                param_tys,
                Box::new(if f.is_async {
                    Ty::Promise(Box::new(ret_ty))
                } else {
                    ret_ty
                }),
            ),
        );
        let _ = writeln!(self.output, "function {name}({params_php})\n{{\n{body}}}\n");
        Ok(())
    }

    fn compile_function_body(
        &mut self,
        f: &Func,
        _name: &str,
        param_tys: &[Ty],
        slot: Option<&Slot>,
    ) -> Result<(String, String)> {
        let mut params_php = Vec::new();
        let mut prologue = String::new();
        for (i, p) in f.params.iter().enumerate() {
            let t = param_tys[i].clone();
            match &p.pat {
                Pat::Id(n, _) => {
                    let php = self.declare_local(n, t.clone(), true);
                    let amp = if self.fx().by_ref.contains(n) { "&" } else { "" };
                    let default = if p.optional || p.default.is_some() {
                        " = null"
                    } else {
                        ""
                    };
                    let hint = php_hint(&t);
                    params_php.push(format!("{hint}{amp}{php}{default}"));
                    if let Some(d) = &p.default {
                        let d = self.expr(d)?;
                        let _ = writeln!(prologue, "    {php} ??= {};", d.php);
                    }
                }
                pat => {
                    let tmp = format!("$__arg{i}");
                    params_php.push(format!("{}{tmp}", php_hint(&t)));
                    let mut lines = String::new();
                    self.bind_pattern(pat, &tmp, &t, true, &mut lines, 1)?;
                    prologue.push_str(&lines);
                }
            }
        }
        let mut body = prologue;
        match &f.body {
            FnBody::Expr(e) => {
                let v = self.return_value(e)?;
                self.note_return(&v.ty, e.span)?;
                let _ = writeln!(body, "    return {};", v.php);
            }
            FnBody::Block(stmts) => {
                body.push_str(&self.block(stmts, 1)?);
                self.note_fallthrough(stmts, f.span)?;
            }
        }
        if let Some(Slot::Hook {
            kind: HookKind::BeforeCreate | HookKind::BeforeUpdate,
            ..
        }) = slot
            && let Some(Pat::Id(n, _)) = f.params.first().map(|p| &p.pat)
            && self.fx().by_ref.contains(n)
        {
            // The runtime passes data by reference; nothing else to do.
        }
        Ok((params_php.join(", "), body))
    }

    fn note_return(&mut self, t: &Ty, span: Span) -> Result<()> {
        let fx = self.fx();
        if matches!(&fx.access, Some((_, op)) if op == "field") && !assignable(t, &Ty::Bool) {
            return err_help(
                span,
                "field rules must return a boolean on every path",
                "return true or false, or throw an error",
            );
        }
        if let Some(r) = &fx.ret {
            if !assignable(t, r) {
                let r = r.clone();
                return err(
                    span,
                    format!(
                        "this returns {}, but the function is declared to return {}",
                        t.describe(),
                        r.describe()
                    ),
                );
            }
        } else {
            fx.returns.push(t.clone());
        }
        Ok(())
    }

    fn note_fallthrough(&mut self, stmts: &[Stmt], span: Span) -> Result<()> {
        let fx = self.fx();
        if block_completions(stmts, &fx.diverging, &fx.exhaustive_switches).contains(&Completion::Normal) {
            self.note_return(&Ty::Null, span)?;
        }
        Ok(())
    }

    // ---- scopes -------------------------------------------------------------

    fn declare_local(&mut self, name: &str, ty: Ty, mutable: bool) -> String {
        let fx = self.fx();
        let shadow = fx.scopes.iter().any(|s| s.contains_key(name)) || fx.declared.iter().any(|d| d == name);
        let php = if shadow && !fx.scopes.last().expect("scope").contains_key(name) {
            fx.tmp += 1;
            format!("${}_{}", name, fx.tmp)
        } else {
            format!("${name}")
        };
        fx.declared.push(php.trim_start_matches('$').to_string());
        fx.scopes.last_mut().expect("scope").insert(
            name.to_string(),
            Local {
                php: php.clone(),
                ty,
                mutable,
            },
        );
        php
    }

    fn set_local_ty(&mut self, name: &str, ty: Ty) {
        for s in self.fx().scopes.iter_mut().rev() {
            if let Some(l) = s.get_mut(name) {
                l.ty = ty;
                return;
            }
        }
    }

    fn resolve(&mut self, name: &str, span: Span) -> Result<Resolved> {
        // Locals of the current function, then enclosing compiled functions (closures).
        let fx = self.fx.as_mut().expect("fn");
        for s in fx.scopes.iter().rev() {
            if let Some(l) = s.get(name) {
                return Ok(Resolved::Local(l.clone()));
            }
        }
        let mut depth = 0;
        let mut outer = fx.outer.as_deref();
        let mut found = None;
        while let Some(o) = outer {
            depth += 1;
            if let Some(l) = o.scopes.iter().rev().find_map(|s| s.get(name)) {
                found = Some(l.clone());
                break;
            }
            outer = o.outer.as_deref();
        }
        if let Some(l) = found {
            let _ = depth;
            // Record the capture on every closure level between here and the owner.
            let fx = self.fx.as_mut().expect("fn");
            let var = l.php.trim_start_matches('$').to_string();
            let mut cur = Some(fx);
            while let Some(c) = cur {
                if c.scopes.iter().any(|s| s.values().any(|x| x.php == l.php)) {
                    break;
                }
                if let Some(caps) = &mut c.captures
                    && !caps.iter().any(|(n, _)| *n == var)
                {
                    caps.push((var.clone(), l.mutable));
                }
                cur = c.outer.as_deref_mut();
            }
            return Ok(Resolved::Local(l));
        }
        if let Some(b) = fx.env.lookup(name) {
            return Ok(Resolved::Value(b.value.clone(), b));
        }
        if let Some(g) = GLOBALS.iter().find(|g| **g == name) {
            return Ok(Resolved::Global(g));
        }
        let mut d = Diag::new(span, format!("`{name}` isn't defined"));
        let names: Vec<String> = fx.scopes.iter().flat_map(|s| s.keys().cloned()).collect();
        if let Some(s) = suggest(name, names.iter().map(String::as_str)) {
            d = d.help(format!("did you mean `{s}`?"));
        }
        Err(d)
    }

    // ---- types --------------------------------------------------------------

    fn resolve_ann(&mut self, a: &TyAnn, module: usize, generics: &HashMap<String, Ty>) -> Result<Ty> {
        Ok(match a {
            TyAnn::Num => Ty::Num,
            TyAnn::Str => Ty::Str,
            TyAnn::StrLit(s) => Ty::StrLit(s.clone()),
            TyAnn::Bool => Ty::Bool,
            TyAnn::BoolLit(value) => Ty::BoolLit(*value),
            TyAnn::Null | TyAnn::Undefined | TyAnn::Void => Ty::Null,
            TyAnn::Unknown => Ty::Unknown,
            TyAnn::Never => Ty::Never,
            TyAnn::Any => {
                return err_help(
                    Span::NONE,
                    "`any` isn't allowed in Zero code",
                    "use a precise type, or `unknown` and narrow it",
                );
            }
            TyAnn::Array(t) => Ty::Array(Box::new(self.resolve_ann(t, module, generics)?)),
            TyAnn::Tuple(ts) => Ty::Tuple(
                ts.iter()
                    .map(|t| self.resolve_ann(t, module, generics))
                    .collect::<Result<_>>()?,
            ),
            TyAnn::Obj(fields) => {
                let mut out = IndexMap::new();
                for (k, t, opt) in fields {
                    let t = self.resolve_ann(t, module, generics)?;
                    out.insert(k.clone(), (if *opt { t.nullable() } else { t }, *opt));
                }
                Ty::Obj(out)
            }
            TyAnn::Map(t) => Ty::Map(Box::new(self.resolve_ann(t, module, generics)?)),
            TyAnn::Union(ts) => Ty::union(
                ts.iter()
                    .map(|t| self.resolve_ann(t, module, generics))
                    .collect::<Result<Vec<_>>>()?,
            ),
            TyAnn::Fn(params, ret) => Ty::Fn(
                params
                    .iter()
                    .map(|(t, _)| self.resolve_ann(t, module, generics))
                    .collect::<Result<_>>()?,
                Box::new(self.resolve_ann(ret, module, generics)?),
            ),
            TyAnn::Ref(name, args, span) => {
                if let Some(t) = generics.get(name) {
                    return Ok(t.clone());
                }
                if args.is_empty() {
                    for stmt in &self.ev_program().modules[module].body {
                        if let Stmt::Import { source, specs, .. } = stmt
                            && source == crate::loader::ZERO_MODULE
                        {
                            for spec in specs {
                                if spec.local == *name
                                    && let ImportName::Named(imported) = &spec.imported
                                {
                                    match imported.as_str() {
                                        "FieldAccessCtx" => return Ok(types::field_access_ctx()),
                                        "JobCtx" => return Ok(types::job_ctx()),
                                        _ => {}
                                    }
                                }
                            }
                        }
                    }
                }
                match (name.as_str(), args.as_slice()) {
                    ("Promise", [t]) => Ty::Promise(Box::new(self.resolve_ann(t, module, generics)?)),
                    ("Date", []) => Ty::Date,
                    ("RegExp", []) => Ty::Regex,
                    ("Error", []) => Ty::Error,
                    ("Partial", [t]) => types::partial(self.resolve_ann(t, module, generics)?),
                    ("Readonly", [t]) | ("NonNullable", [t]) => {
                        let t = self.resolve_ann(t, module, generics)?;
                        if name == "NonNullable" { t.non_null() } else { t }
                    }
                    ("InferSelectModel" | "InferInsertModel", [TyAnn::Query(path, qspan)]) => {
                        let table = self.collection_from_query(path, *qspan, module)?;
                        if name == "InferSelectModel" {
                            types::row(self.schema, &table)
                        } else {
                            types::insert(self.schema, &table)
                        }
                    }
                    _ => {
                        let key = (module, name.clone());
                        if let Some((params, body)) = self.type_aliases.get(&key).cloned() {
                            let mut g = generics.clone();
                            for (i, p) in params.iter().enumerate() {
                                let t = match args.get(i) {
                                    Some(a) => self.resolve_ann(a, module, generics)?,
                                    None => Ty::Unknown,
                                };
                                g.insert(p.clone(), t);
                            }
                            return self.resolve_ann(&body, module, &g);
                        }
                        // An imported type alias: follow the import.
                        if let Some((src_module, src_name)) = self.imported_type(module, name) {
                            return self.resolve_ann(&TyAnn::Ref(src_name, args.clone(), *span), src_module, generics);
                        }
                        return err(*span, format!("unknown type `{name}`"));
                    }
                }
            }
            TyAnn::Query(_, span) => {
                return err_help(
                    *span,
                    "`typeof` types aren't supported here",
                    "use InferSelectModel<typeof items> for rows",
                );
            }
            TyAnn::Indexed(t, key) => {
                let t = self.resolve_ann(t, module, generics)?;
                match t.field(key) {
                    Some((t, _)) => t,
                    None => return err(Span::NONE, format!("{} has no field `{key}`", t.describe())),
                }
            }
        })
    }

    fn imported_type(&self, module: usize, name: &str) -> Option<(usize, String)> {
        let program_modules = self.ev_program();
        let m = &program_modules.modules[module];
        for s in &m.body {
            if let Stmt::Import { source, specs, .. } = s {
                for spec in specs {
                    if spec.local == name {
                        let target = *program_modules.resolved.get(&(module, source.clone()))?;
                        let src = match &spec.imported {
                            ImportName::Named(n) => n.clone(),
                            _ => return None,
                        };
                        return Some((target, src));
                    }
                }
            }
        }
        None
    }

    fn ev_program(&self) -> &crate::loader::Program {
        self.ev.program()
    }

    fn collection_from_query(&mut self, path: &[String], span: Span, module: usize) -> Result<String> {
        let scope = self.ev.module_scope(module).expect("module evaluated");
        let mut v = match scope.lookup(&path[0]) {
            Some(b) => b.value,
            None => return err(span, format!("`{}` isn't defined", path[0])),
        };
        for p in &path[1..] {
            v = match &v {
                Value::Object(o) => o.borrow().get(p).cloned().unwrap_or(Value::Undef),
                _ => Value::Undef,
            };
        }
        match v {
            Value::Collection(c) => self.table_of(&c, span),
            other => err(
                span,
                format!("`typeof {}` is {}, not a collection", path.join("."), other.describe()),
            ),
        }
    }

    fn table_of(&self, c: &Rc<CollectionVal>, span: Span) -> Result<String> {
        if self.collections.iter().any(|x| Rc::ptr_eq(x, c)) {
            Ok(c.table.clone())
        } else {
            err(span, format!("collection \"{}\" isn't in `schema`", c.table))
        }
    }

    // ---- statements -----------------------------------------------------------

    fn block(&mut self, stmts: &[Stmt], indent: usize) -> Result<String> {
        self.fx().scopes.push(HashMap::new());
        let r = self.stmts(stmts, indent);
        self.fx().scopes.pop();
        r
    }

    fn stmts(&mut self, stmts: &[Stmt], indent: usize) -> Result<String> {
        let mut out = String::new();
        // Local function declarations are hoisted: compile them first.
        for s in stmts {
            if let Stmt::Func(f) = s {
                let name = f.name.clone().expect("named");
                let php = self.declare_local(&name, Ty::Unknown, false);
                let c = self.closure_expr(f)?;
                self.set_local_ty(&name, c.ty.clone());
                let _ = writeln!(out, "{}{php} = {};", pad(indent), c.php);
            }
        }
        let mut terminated = false;
        for s in stmts {
            if terminated {
                return err(stmt_span(s), "this code can never run");
            }
            out.push_str(&self.stmt(s, indent)?);
            terminated = matches!(
                s,
                Stmt::Return(..) | Stmt::Throw(_) | Stmt::Break(_) | Stmt::Continue(_)
            );
        }
        Ok(out)
    }

    fn stmt(&mut self, s: &Stmt, indent: usize) -> Result<String> {
        let p = pad(indent);
        let mut out = String::new();
        match s {
            Stmt::Decl {
                kind,
                pat,
                ann,
                init,
                span,
            } => {
                let declared = match ann {
                    Some(a) => {
                        let module = self.fx().module;
                        Some(self.resolve_ann(a, module, &HashMap::new())?)
                    }
                    None => None,
                };
                let value = match init {
                    Some(e) => {
                        let v = self.expr(e)?;
                        Some(self.finish_value(v, e.span)?)
                    }
                    None => None,
                };
                let ty = match (&declared, &value) {
                    (Some(d), Some(v)) => {
                        if !assignable(&v.ty, d) {
                            return err(
                                *span,
                                format!("{} isn't assignable to {}", v.ty.describe(), d.describe()),
                            );
                        }
                        d.clone()
                    }
                    (Some(d), None) => d.clone().nullable(),
                    (None, Some(v)) => inferred_binding_type(&v.ty, *kind == DeclKind::Let),
                    (None, None) => {
                        return err_help(
                            *span,
                            "this variable needs a type or a value",
                            "write `let x: number = 0`",
                        );
                    }
                };
                let mutable = *kind == DeclKind::Let;
                match pat {
                    Pat::Id(n, _) => {
                        let php = self.declare_local(n, ty, mutable);
                        let v = value.map(|v| v.php).unwrap_or_else(|| "null".into());
                        let _ = writeln!(out, "{p}{php} = {v};");
                    }
                    pat => {
                        let v = value.expect("destructuring needs a value");
                        let src = if v.place.is_some() || v.atomic && v.php.starts_with('$') {
                            v.php.clone()
                        } else {
                            let tmp = self.tmp_var();
                            let _ = writeln!(out, "{p}{tmp} = {};", v.php);
                            tmp
                        };
                        self.bind_pattern(pat, &src, &ty, mutable, &mut out, indent)?;
                    }
                }
            }
            Stmt::Func(_) => {} // hoisted in `stmts`
            Stmt::TypeAlias { .. } => {}
            Stmt::Expr(e) => {
                let v = self.expr(e)?;
                if matches!(v.ty, Ty::Promise(_)) {
                    return err_help(
                        e.span,
                        "this async call isn't awaited",
                        "add `await`; Zero runs async calls in order",
                    );
                }
                if matches!(v.ty, Ty::Builder(_)) {
                    return err_help(e.span, "this database call never runs", "add `await` in front of it");
                }
                let _ = writeln!(out, "{p}{};", v.php);
            }
            Stmt::Return(e, span) => match e {
                Some(e) => {
                    let v = self.return_value(e)?;
                    self.note_return(&v.ty, *span)?;
                    let _ = writeln!(out, "{p}return {};", v.php);
                }
                None => {
                    self.note_return(&Ty::Null, *span)?;
                    let _ = writeln!(out, "{p}return null;");
                }
            },
            Stmt::If(test, then, otherwise) => {
                let narrow = self.narrowing(test);
                let t = self.cond(test)?;
                let _ = writeln!(out, "{p}if ({t}) {{");
                self.fx().scopes.push(HashMap::new());
                self.apply_narrowing(&narrow, true);
                out.push_str(&self.stmts(then, indent + 1)?);
                self.fx().scopes.pop();
                let then_exits = ends_with_exit(then);
                if let Some(o) = otherwise {
                    let _ = writeln!(out, "{p}}} else {{");
                    self.fx().scopes.push(HashMap::new());
                    self.apply_narrowing(&narrow, false);
                    out.push_str(&self.stmts(o, indent + 1)?);
                    self.fx().scopes.pop();
                }
                let _ = writeln!(out, "{p}}}");
                // `if (!x) return;` narrows `x` for the rest of the block.
                if then_exits && otherwise.is_none() {
                    self.apply_narrowing(&narrow, false);
                }
            }
            Stmt::Block(b) => {
                let inner = self.block(b, indent)?;
                out.push_str(&inner);
            }
            Stmt::For {
                init,
                test,
                update,
                body,
                ..
            } => {
                self.fx().scopes.push(HashMap::new());
                let init_php = match init {
                    Some(i) => self.stmt(i, 0)?.trim().trim_end_matches(';').to_string(),
                    None => String::new(),
                };
                let test_php = match test {
                    Some(t) => self.cond(t)?,
                    None => String::new(),
                };
                let update_php = match update {
                    Some(u) => self.expr(u)?.php,
                    None => String::new(),
                };
                let _ = writeln!(out, "{p}for ({init_php}; {test_php}; {update_php}) {{");
                out.push_str(&self.loop_body(body, indent + 1)?);
                let _ = writeln!(out, "{p}}}");
                self.fx().scopes.pop();
            }
            Stmt::ForOf {
                kind, pat, iter, body, ..
            } => {
                let it = self.expr(iter)?;
                let it = self.finish_value(it, iter.span)?;
                let (el, src) = match &it.ty.non_null() {
                    Ty::Array(t) => ((**t).clone(), it.php.clone()),
                    Ty::Tuple(ts) | Ty::ArrayLiteral(ts) => (Ty::union(ts.clone()), it.php.clone()),
                    t if t.is_str() => (Ty::Str, format!("mb_str_split({})", it.php)),
                    other => return err(iter.span, format!("can't loop over {}", other.describe())),
                };
                if it.ty.is_nullable() {
                    return err_help(
                        iter.span,
                        format!("this might be null ({})", it.ty.describe()),
                        "check it first, or use `?? []`",
                    );
                }
                self.fx().scopes.push(HashMap::new());
                let el = widen_literal_array(&el);
                let mutable = *kind == DeclKind::Let;
                match pat {
                    Pat::Id(n, _) => {
                        let php = self.declare_local(n, el, mutable);
                        let _ = writeln!(out, "{p}foreach ({src} as {php}) {{");
                    }
                    pat => {
                        let tmp = self.tmp_var();
                        let _ = writeln!(out, "{p}foreach ({src} as {tmp}) {{");
                        self.bind_pattern(pat, &tmp, &el, mutable, &mut out, indent + 1)?;
                    }
                }
                out.push_str(&self.loop_body(body, indent + 1)?);
                let _ = writeln!(out, "{p}}}");
                self.fx().scopes.pop();
            }
            Stmt::While(test, body) => {
                let t = self.cond(test)?;
                let _ = writeln!(out, "{p}while ({t}) {{");
                out.push_str(&self.loop_body(body, indent + 1)?);
                let _ = writeln!(out, "{p}}}");
            }
            Stmt::Break(_) => {
                let _ = writeln!(out, "{p}break;");
            }
            Stmt::Continue(_) => {
                // In PHP a `switch` counts as a loop level for `continue`.
                match self.fx().switch_depth {
                    0 => writeln!(out, "{p}continue;"),
                    n => writeln!(out, "{p}continue {};", n + 1),
                }
                .ok();
            }
            Stmt::Throw(e) => {
                let v = self.throw_value(e)?;
                let _ = writeln!(out, "{p}throw {v};");
            }
            Stmt::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                let _ = writeln!(out, "{p}try {{");
                out.push_str(&self.block(block, indent + 1)?);
                if let Some(h) = handler {
                    self.fx().scopes.push(HashMap::new());
                    let var = match param {
                        Some((n, _)) => self.declare_local(n, Ty::Error, false),
                        None => "$__e".to_string(),
                    };
                    // Database and validation errors propagate: they must roll back the request.
                    let _ = writeln!(out, "{p}}} catch (\\Zero\\JsError {var}) {{");
                    out.push_str(&self.stmts(h, indent + 1)?);
                    self.fx().scopes.pop();
                }
                if let Some(f) = finalizer {
                    let _ = writeln!(out, "{p}}} finally {{");
                    out.push_str(&self.block(f, indent + 1)?);
                }
                let _ = writeln!(out, "{p}}}");
            }
            Stmt::Switch { disc, cases, span } => {
                let d = self.expr(disc)?;
                let d = self.finish_value(d, disc.span)?;
                if !(d.ty.is_num() || d.ty.non_null().is_str() || d.ty.non_null().is_bool()) {
                    return err(
                        *span,
                        format!(
                            "`switch` works on numbers, strings, and booleans, not {}",
                            d.ty.describe()
                        ),
                    );
                }
                // PHP `switch` compares loosely; compile to strict comparisons.
                let mut case_types = Vec::new();
                let tmp = self.tmp_var();
                let _ = writeln!(out, "{p}{tmp} = {};", d.php);
                let _ = writeln!(out, "{p}switch (true) {{");
                for (test, body) in cases {
                    match test {
                        Some(t) => {
                            let tv = self.expr(t)?;
                            let cmp = self.strict_eq(&Out::atom(tmp.clone(), d.ty.clone()), &tv);
                            case_types.push(tv.ty);
                            let _ = writeln!(out, "{p}    case {cmp}:");
                        }
                        None => {
                            let _ = writeln!(out, "{p}    default:");
                        }
                    }
                    self.fx().switch_depth += 1;
                    let inner = self.block(body, indent + 2);
                    self.fx().switch_depth -= 1;
                    out.push_str(&inner?);
                }
                if switch_is_exhaustive(&d.ty, &case_types) {
                    self.fx().exhaustive_switches.insert(*span);
                }
                let _ = writeln!(out, "{p}}}");
            }
            Stmt::Import { span, .. } | Stmt::ExportNames { span, .. } | Stmt::ExportAll { span, .. } => {
                return err(*span, "imports belong at the top level of a module");
            }
            Stmt::ExportDefault(e) => return err(e.span, "`export default` belongs at the top level"),
            Stmt::Exported(inner) => return self.stmt(inner, indent),
        }
        Ok(out)
    }

    fn loop_body(&mut self, body: &[Stmt], indent: usize) -> Result<String> {
        let saved = std::mem::take(&mut self.fx().switch_depth);
        let r = self.block(body, indent);
        self.fx().switch_depth = saved;
        r
    }

    fn tmp_var(&mut self) -> String {
        let fx = self.fx();
        fx.tmp += 1;
        let name = format!("__t{}", fx.tmp);
        fx.declared.push(name.clone());
        format!("${name}")
    }

    /// A `return` operand. In an access rule it must be a boolean or a filter literal (§1.6).
    fn return_value(&mut self, e: &Expr) -> Result<Out> {
        let Some((table, op)) = self.fx().access.clone() else {
            let v = self.expr(e)?;
            return self.finish_value(v, e.span);
        };
        match &e.kind {
            ExprKind::Cond(t, a, b) => {
                let narrow = self.narrowing(t);
                let tc = self.cond(t)?;
                self.fx().scopes.push(HashMap::new());
                self.apply_narrowing(&narrow, true);
                let av = self.return_value(a);
                self.fx().scopes.pop();
                let av = av?;
                self.fx().scopes.push(HashMap::new());
                self.apply_narrowing(&narrow, false);
                let bv = self.return_value(b);
                self.fx().scopes.pop();
                let bv = bv?;
                Ok(Out::new(
                    format!("{} ? {} : {}", paren(&tc), av.wrapped(), bv.wrapped()),
                    Ty::union([av.ty, bv.ty]),
                ))
            }
            ExprKind::Object(_) => match table {
                Some(t) if op != "create" => {
                    let php = self.filter(&t, e, true)?;
                    Ok(Out::atom(php, Ty::Map(Box::new(Ty::Unknown))))
                }
                Some(_) => err_help(
                    e.span,
                    "create rules return a boolean",
                    "a new row has nothing to filter; return true or false (check `ctx.data` if needed)",
                ),
                None => err_help(
                    e.span,
                    format!("{op} rules here return a boolean"),
                    "filters only apply to collection read, update, and delete rules",
                ),
            },
            _ => {
                let v = self.expr(e)?;
                let v = self.finish_value(v, e.span)?;
                if v.ty.is_bool() || v.ty == Ty::Never {
                    return Ok(v);
                }
                err_help(
                    e.span,
                    format!("access rules return true, false, or a filter, not {}", v.ty.describe()),
                    "write a filter inline (`{ status: \"published\" }`) or turn the value into a boolean",
                )
            }
        }
    }

    fn throw_value(&mut self, e: &Expr) -> Result<String> {
        if let ExprKind::New { callee, args } = &e.kind {
            let callee_v = match &callee.kind {
                ExprKind::Ident(n) => self.resolve(n, callee.span)?,
                _ => return err(callee.span, "throw `new Error(...)` or `new HttpError(...)`"),
            };
            match callee_v {
                Resolved::Global(g @ ("Error" | "TypeError" | "RangeError")) => {
                    let msg = match args.first() {
                        Some(ArrEl::Item(m)) => {
                            let v = self.expr(m)?;
                            self.to_string_php(&v, m.span)?
                        }
                        None => "''".into(),
                        Some(ArrEl::Spread(s)) => return err(s.span, "spread arguments aren't supported here"),
                    };
                    return Ok(format!("new \\Zero\\JsError({msg}, {})", php_str(g)));
                }
                Resolved::Value(Value::Builtin(Builtin::HttpError), _) => {
                    let mut parts = Vec::new();
                    for (i, a) in args.iter().enumerate() {
                        let ArrEl::Item(a) = a else {
                            return err(e.span, "spread arguments aren't supported here");
                        };
                        let v = self.expr(a)?;
                        let want = if i == 0 { Ty::Num } else { Ty::Str };
                        if !assignable(&v.ty, &want) {
                            return err(
                                a.span,
                                format!(
                                    "HttpError argument {} must be a {}, not {}",
                                    i + 1,
                                    want.describe(),
                                    v.ty.describe()
                                ),
                            );
                        }
                        parts.push(if i == 0 {
                            format!("(int) {}", v.wrapped())
                        } else {
                            v.php
                        });
                    }
                    if !(3..=4).contains(&parts.len()) {
                        return err(e.span, "HttpError takes (status, code, message)");
                    }
                    return Ok(format!("new \\Zero\\HttpError({})", parts.join(", ")));
                }
                _ => {}
            }
        }
        let v = self.expr(e)?;
        if v.ty == Ty::Error {
            return Ok(v.php);
        }
        err_help(
            e.span,
            "only errors can be thrown",
            "throw `new Error(\"...\")` or `new HttpError(status, code, message)`",
        )
    }

    fn bind_pattern(
        &mut self,
        pat: &Pat,
        src: &str,
        ty: &Ty,
        mutable: bool,
        out: &mut String,
        indent: usize,
    ) -> Result<()> {
        let p = pad(indent);
        match pat {
            Pat::Id(n, _) => {
                let php = self.declare_local(n, ty.clone(), mutable);
                let _ = writeln!(out, "{p}{php} = {src};");
            }
            Pat::Default(inner, default) => {
                let d = self.expr(default)?;
                let present = ty.non_null();
                let t = if assignable(&d.ty, &present) {
                    present
                } else {
                    Ty::union([present, inferred_binding_type(&d.ty, mutable)])
                };
                let tmp = self.tmp_var();
                let _ = writeln!(out, "{p}{tmp} = {src} ?? {};", d.php);
                self.bind_pattern(inner, &tmp, &t, mutable, out, indent)?;
            }
            Pat::Obj { props, rest, span } => {
                let t = ty.non_null();
                if ty.is_nullable() {
                    return err(*span, format!("can't destructure {}: it might be null", ty.describe()));
                }
                for (key, p2) in props {
                    let Some((ft, optional)) = t.field(key) else {
                        let mut d = Diag::new(p2.span(), format!("{} has no field `{key}`", t.describe()));
                        if let Ty::Obj(f) = &t
                            && let Some(s) = suggest(key, f.keys().map(String::as_str))
                        {
                            d = d.help(format!("did you mean `{s}`?"));
                        }
                        return Err(d);
                    };
                    let access = if optional || matches!(t, Ty::Map(_)) {
                        format!("({src}[{}] ?? null)", php_str(key))
                    } else {
                        format!("{src}[{}]", php_str(key))
                    };
                    let ft = if optional || matches!(t, Ty::Map(_)) {
                        ft.nullable()
                    } else {
                        ft
                    };
                    self.bind_pattern(p2, &access, &ft, mutable, out, indent)?;
                }
                if let Some((name, _)) = rest {
                    let keys: Vec<String> = props.iter().map(|(k, _)| php_str(k)).collect();
                    let rest_ty = match &t {
                        Ty::Obj(f) => Ty::Obj(
                            f.iter()
                                .filter(|(k, _)| !props.iter().any(|(pk, _)| pk == *k))
                                .map(|(k, v)| (k.clone(), v.clone()))
                                .collect(),
                        ),
                        other => other.clone(),
                    };
                    let php = self.declare_local(name, rest_ty, mutable);
                    let _ = writeln!(out, "{p}{php} = \\Zero\\Js::omit({src}, [{}]);", keys.join(", "));
                }
            }
            Pat::Arr { elems, rest, span } => {
                let (el_of, is_tuple): (Box<dyn Fn(usize) -> Ty>, bool) = match ty.non_null() {
                    Ty::Array(t) => {
                        let t = (*t).clone();
                        (Box::new(move |_| t.clone()), false)
                    }
                    Ty::Tuple(ts) | Ty::ArrayLiteral(ts) => {
                        (Box::new(move |i| ts.get(i).cloned().unwrap_or(Ty::Null)), true)
                    }
                    other => return err(*span, format!("can't destructure {} as an array", other.describe())),
                };
                for (i, e) in elems.iter().enumerate() {
                    if let Some(e) = e {
                        let access = if is_tuple {
                            format!("{src}[{i}]")
                        } else {
                            format!("({src}[{i}] ?? null)")
                        };
                        self.bind_pattern(e, &access, &el_of(i), mutable, out, indent)?;
                    }
                }
                if let Some((name, _)) = rest {
                    let php = self.declare_local(name, Ty::Array(Box::new(el_of(elems.len()).non_null())), mutable);
                    let _ = writeln!(out, "{p}{php} = array_slice({src}, {});", elems.len());
                }
            }
        }
        Ok(())
    }

    // ---- narrowing ------------------------------------------------------------

    /// `x`, `!x`, `x === null`, `x != null`, `x && ...` narrow `x` in branches.
    fn narrowing(&mut self, test: &Expr) -> Vec<(String, Ty, Ty)> {
        let mut out = Vec::new();
        self.collect_narrowing(test, false, &mut out);
        out
    }

    fn collect_narrowing(&mut self, test: &Expr, negate: bool, out: &mut Vec<(String, Ty, Ty)>) {
        match &test.kind {
            ExprKind::Ident(_) | ExprKind::Member { .. } | ExprKind::Chain(_) => {
                if let Some((n, t)) = self.path_ty(test) {
                    let (yes, no) = (t.non_null(), t.clone());
                    out.push(if negate { (n, no, yes) } else { (n, yes, no) });
                }
            }
            ExprKind::Unary(UnOp::Not, inner) => self.collect_narrowing(inner, !negate, out),
            ExprKind::IsNullish(inner, negated) => {
                if let Some((n, t)) = self.path_ty(inner) {
                    // `x == null` true → null branch; false → non-null.
                    let is_null_branch = *negated == negate;
                    let (yes, no) = if is_null_branch {
                        (Ty::Null, t.non_null())
                    } else {
                        (t.non_null(), Ty::Null)
                    };
                    out.push((n, yes, no));
                }
            }
            ExprKind::Binary(op @ (BinOp::Eq | BinOp::Ne), l, r) => {
                // `item.layout === "hero"` picks that member of a blocks item union.
                let (member, lit) = match (&l.kind, &r.kind) {
                    (ExprKind::Member { obj, prop, .. }, ExprKind::Str(s)) if prop == "layout" => (Some(obj), s),
                    (ExprKind::Str(s), ExprKind::Member { obj, prop, .. }) if prop == "layout" => (Some(obj), s),
                    _ => (None, &String::new()),
                };
                if let Some(obj) = member
                    && let Some((n, t)) = self.path_ty(obj)
                    && let Ty::Union(items) = t.non_null()
                    && items.iter().any(|i| types::layout_of(i).is_some())
                {
                    let (hit, miss): (Vec<Ty>, Vec<Ty>) = items
                        .iter()
                        .cloned()
                        .partition(|i| types::layout_of(i) == Some(lit.as_str()));
                    let yes_is_hit = (*op == BinOp::Eq) != negate;
                    let (yes, no) = if yes_is_hit {
                        (Ty::union(hit), Ty::union(miss))
                    } else {
                        (Ty::union(miss), Ty::union(hit))
                    };
                    out.push((n, yes, no));
                    return;
                }
                let (subject, other) = match (&l.kind, &r.kind) {
                    (ExprKind::Null | ExprKind::Undefined, _) => (r, l),
                    _ => (l, r),
                };
                if matches!(other.kind, ExprKind::Null | ExprKind::Undefined)
                    && let Some((n, t)) = self.path_ty(subject)
                {
                    let is_null_branch = (*op == BinOp::Eq) != negate;
                    let (yes, no) = if is_null_branch {
                        (Ty::Null, t.non_null())
                    } else {
                        (t.non_null(), Ty::Null)
                    };
                    out.push((n, yes, no));
                }
            }
            ExprKind::Logical(LogOp::And, l, r) if !negate => {
                let start = out.len();
                self.collect_narrowing(l, false, out);
                // The right side is checked with the left side's narrowing applied.
                let left: Vec<_> = out[start..].to_vec();
                self.fx().scopes.push(HashMap::new());
                self.apply_narrowing(&left, true);
                self.collect_narrowing(r, false, out);
                self.fx().scopes.pop();
                // Only the "true" side is sound for both operands: the false side keeps the declared type.
                for entry in &mut out[start..] {
                    if let Some(declared) = self.declared_path_ty(&entry.0) {
                        entry.2 = declared;
                    }
                }
            }
            _ => {}
        }
    }

    /// `ctx.user` → ("ctx.user", its type) for paths rooted at a local.
    fn path_ty(&mut self, e: &Expr) -> Option<(String, Ty)> {
        let path = self.path_of(e)?;
        let saved_tmp = self.fx().tmp;
        let t = self.expr(e).ok().map(|o| o.ty);
        self.fx().tmp = saved_tmp;
        Some((path, t?))
    }

    fn path_of(&self, e: &Expr) -> Option<String> {
        match &e.kind {
            ExprKind::Ident(n) => {
                let fx = self.fx.as_ref()?;
                fx.scopes.iter().any(|s| s.contains_key(n)).then(|| n.clone())
            }
            ExprKind::Member { obj, prop, .. } => Some(format!("{}.{prop}", self.path_of(obj)?)),
            ExprKind::Chain(inner) | ExprKind::NonNull(inner) => self.path_of(inner),
            _ => None,
        }
    }

    /// The type a path had before any narrowing in the current branch stack (outermost entry).
    fn declared_path_ty(&self, name: &str) -> Option<Ty> {
        self.fx
            .as_ref()?
            .scopes
            .iter()
            .find_map(|s| s.get(name))
            .map(|l| l.ty.clone())
    }

    /// A narrowed type recorded for a member path (`ctx.user` after `if (ctx.user)`).
    fn narrowed_path(&self, path: &str) -> Option<Ty> {
        self.fx
            .as_ref()?
            .scopes
            .iter()
            .rev()
            .find_map(|s| s.get(path))
            .map(|l| l.ty.clone())
    }

    fn apply_narrowing(&mut self, n: &[(String, Ty, Ty)], truthy: bool) {
        for (name, yes, no) in n {
            let t = if truthy { yes.clone() } else { no.clone() };
            if name.contains('.') {
                // Member path: a type override read by `member()`, never a PHP variable.
                self.fx().scopes.last_mut().expect("scope").insert(
                    name.clone(),
                    Local {
                        php: String::new(),
                        ty: t,
                        mutable: false,
                    },
                );
                continue;
            }
            let Some(local) = self.fx().scopes.iter().rev().find_map(|s| s.get(name)).cloned() else {
                continue;
            };
            self.fx()
                .scopes
                .last_mut()
                .expect("scope")
                .insert(name.clone(), Local { ty: t, ..local });
        }
    }

    // ---- expressions ------------------------------------------------------------

    /// A condition: native when the value is boolean, `Js::truthy` otherwise.
    fn cond(&mut self, e: &Expr) -> Result<String> {
        let v = self.expr(e)?;
        let v = self.finish_value(v, e.span)?;
        Ok(self.truthy(&v))
    }

    fn truthy(&self, v: &Out) -> String {
        match &v.ty {
            t if t.is_bool() => v.php.clone(),
            // Objects, arrays, and functions are always truthy; only null is falsy.
            t if t.non_null().all(|x| {
                matches!(
                    x,
                    Ty::Obj(_)
                        | Ty::Map(_)
                        | Ty::Array(_)
                        | Ty::Tuple(_)
                        | Ty::ArrayLiteral(_)
                        | Ty::Fn(..)
                        | Ty::Date
                        | Ty::Error
                )
            }) =>
            {
                format!("{} !== null", v.wrapped())
            }
            t if t.non_null().is_str() => format!("({} ?? '') !== ''", v.wrapped()),
            _ => format!("\\Zero\\Js::truthy({})", v.php),
        }
    }

    /// Rejects values that can't exist at runtime as plain data (unawaited calls, builders).
    fn finish_value(&mut self, v: Out, span: Span) -> Result<Out> {
        match &v.ty {
            Ty::Builder(_) => err_help(span, "this database call never runs", "add `await` in front of it"),
            Ty::Promise(_) => err_help(
                span,
                "this async call isn't awaited",
                "add `await`; Zero runs async calls in order",
            ),
            Ty::Db | Ty::DbQuery | Ty::QueryColl(_) => {
                err(span, "`db` can't be stored in a variable; call it directly")
            }
            Ty::Collection(_) => err_help(
                span,
                "collections can't be used as values in hooks",
                "pass the collection to db.insert/update/delete",
            ),
            _ => Ok(v),
        }
    }

    fn expr(&mut self, e: &Expr) -> Result<Out> {
        let span = e.span;
        let out = match &e.kind {
            ExprKind::Num(n) => Out::atom(php_number(*n), Ty::Num),
            ExprKind::Str(s) => Out::atom(php_str(s), Ty::FreshStrLit(s.clone())),
            ExprKind::Bool(b) => Out::atom(b.to_string(), Ty::FreshBoolLit(*b)),
            ExprKind::Null | ExprKind::Undefined => Out::atom("null", Ty::Null),
            ExprKind::Regex { pattern, flags } => Out::atom(
                format!("\\Zero\\Js::re({}, {})", php_str(pattern), php_str(flags)),
                Ty::Regex,
            ),
            ExprKind::Template(quasis, exprs) => {
                let mut parts = Vec::new();
                if !quasis[0].is_empty() {
                    parts.push(php_str(&quasis[0]));
                }
                for (i, x) in exprs.iter().enumerate() {
                    let v = self.expr(x)?;
                    let v = self.finish_value(v, x.span)?;
                    parts.push(self.to_string_php(&v, x.span)?);
                    if !quasis[i + 1].is_empty() {
                        parts.push(php_str(&quasis[i + 1]));
                    }
                }
                if parts.is_empty() {
                    Out::atom("''", Ty::Str)
                } else {
                    Out::new(parts.join(" . "), Ty::Str)
                }
            }
            ExprKind::Ident(n) => self.ident(n, span)?,
            ExprKind::Array(items) => {
                let mut parts = Vec::new();
                let mut tys = Vec::new();
                for item in items {
                    match item {
                        ArrEl::Item(x) => {
                            let v = self.expr(x)?;
                            let v = self.finish_value(v, x.span)?;
                            tys.push(v.ty.clone());
                            parts.push(v.php);
                        }
                        ArrEl::Spread(x) => {
                            let v = self.expr(x)?;
                            match v.ty.non_null() {
                                Ty::Array(t) => tys.push(*t),
                                Ty::Tuple(ts) | Ty::ArrayLiteral(ts) => tys.extend(ts),
                                other => {
                                    return err(x.span, format!("can't spread {} into an array", other.describe()));
                                }
                            }
                            parts.push(format!("...{}", v.wrapped()));
                        }
                    }
                }
                let ty = if items.iter().all(|i| matches!(i, ArrEl::Item(_))) && !tys.is_empty() && tys.len() <= 8 {
                    Ty::ArrayLiteral(tys)
                } else {
                    Ty::Array(Box::new(Ty::union(tys)))
                };
                Out::atom(format!("[{}]", parts.join(", ")), ty)
            }
            ExprKind::Object(props) => {
                let mut parts = Vec::new();
                let mut fields: IndexMap<String, (Ty, bool)> = IndexMap::new();
                let mut is_map = false;
                for p in props {
                    match p {
                        Prop::KV(key, value) => {
                            let v = self.expr(value)?;
                            let v = self.finish_value(v, value.span)?;
                            match key {
                                PropKey::Static(k) => {
                                    fields.shift_remove(k);
                                    fields.insert(k.clone(), (v.ty.clone(), false));
                                    parts.push(format!("{} => {}", php_str(k), v.php));
                                }
                                PropKey::Computed(kx) => {
                                    let k = self.expr(kx)?;
                                    if !k.ty.is_str() {
                                        return err(
                                            kx.span,
                                            format!("computed keys must be strings, not {}", k.ty.describe()),
                                        );
                                    }
                                    is_map = true;
                                    parts.push(format!("{} => {}", k.php, v.php));
                                }
                            }
                        }
                        Prop::Spread(x) => {
                            let v = self.expr(x)?;
                            match v.ty.non_null() {
                                Ty::Obj(f) => {
                                    for (k, t) in f {
                                        fields.shift_remove(&k);
                                        fields.insert(k, t);
                                    }
                                }
                                Ty::Map(_) => is_map = true,
                                other => {
                                    return err(x.span, format!("can't spread {} into an object", other.describe()));
                                }
                            }
                            let src = if v.ty.is_nullable() {
                                format!("({} ?? [])", v.php)
                            } else {
                                v.wrapped()
                            };
                            parts.push(format!("...{src}"));
                        }
                    }
                }
                let ty = if is_map {
                    Ty::Map(Box::new(Ty::union(fields.values().map(|(t, _)| t.clone()))))
                } else {
                    Ty::Obj(fields)
                };
                Out::atom(format!("[{}]", parts.join(", ")), ty)
            }
            ExprKind::Func(f) => self.closure_expr(f)?,
            ExprKind::Unary(op, x) => {
                let v = self.expr(x)?;
                let v = self.finish_value(v, x.span)?;
                match op {
                    UnOp::Not => Out::new(format!("!{}", paren(&self.truthy(&v))), Ty::Bool),
                    UnOp::Neg => {
                        self.need_num(&v, x.span, "`-`")?;
                        Out::new(format!("-{}", v.wrapped()), Ty::Num)
                    }
                    UnOp::Plus => {
                        if v.ty.is_num() {
                            v
                        } else {
                            Out::atom(format!("\\Zero\\Js::toNumber({})", v.php), Ty::Num)
                        }
                    }
                    UnOp::TypeOf => Out::atom(format!("\\Zero\\Js::typeOf({})", v.php), Ty::Str),
                }
            }
            ExprKind::Binary(op, l, r) => {
                let a = self.expr(l)?;
                let a = self.finish_value(a, l.span)?;
                let b = self.expr(r)?;
                let b = self.finish_value(b, r.span)?;
                self.binary(*op, a, b, span)?
            }
            ExprKind::IsNullish(x, negated) => {
                let v = self.expr(x)?;
                Out::new(
                    format!("{} {} null", v.wrapped(), if *negated { "!==" } else { "===" }),
                    Ty::Bool,
                )
            }
            ExprKind::Logical(op, l, r) => {
                let a = self.expr(l)?;
                let a = self.finish_value(a, l.span)?;
                // Narrow the right side by the left (`x && x.y`).
                let narrow = self.narrowing(l);
                self.fx().scopes.push(HashMap::new());
                self.apply_narrowing(&narrow, *op == LogOp::And);
                let b = self.expr(r);
                self.fx().scopes.pop();
                let b = b?;
                let b = self.finish_value(b, r.span)?;
                match op {
                    LogOp::Nullish => Out::new(
                        format!("{} ?? {}", a.wrapped(), b.wrapped()),
                        Ty::union([a.ty.non_null(), b.ty]),
                    ),
                    LogOp::And | LogOp::Or if a.ty.is_bool() && b.ty.is_bool() => Out::new(
                        format!(
                            "{} {} {}",
                            a.wrapped(),
                            if *op == LogOp::And { "&&" } else { "||" },
                            b.wrapped()
                        ),
                        Ty::Bool,
                    ),
                    LogOp::Or | LogOp::And => {
                        // `x || y` / `x && y` return an operand, not a boolean.
                        let tmp = self.tmp_var();
                        let test = self.truthy(&Out::new(format!("{tmp} = {}", a.php), a.ty.clone()));
                        let (yes, no) = if *op == LogOp::Or {
                            (tmp.clone(), b.wrapped())
                        } else {
                            (b.wrapped(), tmp.clone())
                        };
                        let ty = if *op == LogOp::Or {
                            Ty::union([a.ty.non_null(), b.ty])
                        } else {
                            Ty::union([a.ty, b.ty])
                        };
                        Out::new(format!("{} ? {yes} : {no}", paren(&test)), ty)
                    }
                }
            }
            ExprKind::Cond(t, a, b) => {
                let narrow = self.narrowing(t);
                let tc = self.cond(t)?;
                self.fx().scopes.push(HashMap::new());
                self.apply_narrowing(&narrow, true);
                let av = self.expr(a);
                self.fx().scopes.pop();
                let av = self.finish_value(av?, a.span)?;
                self.fx().scopes.push(HashMap::new());
                self.apply_narrowing(&narrow, false);
                let bv = self.expr(b);
                self.fx().scopes.pop();
                let bv = self.finish_value(bv?, b.span)?;
                Out::new(
                    format!("{} ? {} : {}", paren(&tc), av.wrapped(), bv.wrapped()),
                    Ty::union([av.ty, bv.ty]),
                )
            }
            ExprKind::Assign { op, target, value } => self.assign(*op, target, value, span)?,
            ExprKind::Update { inc, prefix, target } => {
                let t = self.place(target)?;
                self.need_num(&t, target.span, if *inc { "`++`" } else { "`--`" })?;
                let o = if *inc { "++" } else { "--" };
                Out::new(
                    if *prefix {
                        format!("{o}{}", t.php)
                    } else {
                        format!("{}{o}", t.php)
                    },
                    Ty::Num,
                )
            }
            ExprKind::Call {
                callee, args, optional, ..
            } => self.call(callee, args, *optional, span)?,
            ExprKind::New { callee, args } => self.new_expr(callee, args, span)?,
            ExprKind::Member {
                obj,
                prop,
                optional,
                prop_span,
            } => self.member(obj, prop, *optional, *prop_span, span)?,
            ExprKind::Index { obj, index, optional } => self.index(obj, index, *optional, span)?,
            ExprKind::Chain(inner) => self.expr(inner)?,
            ExprKind::Await(x) => self.await_expr(x, span)?,
            ExprKind::As(x, ann) => {
                let v = self.expr(x)?;
                let module = self.fx().module;
                let t = self.resolve_ann(ann, module, &HashMap::new())?;
                if !(assignable(&v.ty, &t) || assignable(&t, &v.ty) || v.ty == Ty::Unknown) {
                    return err(span, format!("can't treat {} as {}", v.ty.describe(), t.describe()));
                }
                Out { ty: t, ..v }
            }
            ExprKind::NonNull(x) => {
                let v = self.expr(x)?;
                let t = v.ty.non_null();
                Out { ty: t, ..v }
            }
        };
        if out.ty == Ty::Never {
            self.fx().diverging.insert(span);
        }
        Ok(out)
    }

    fn need_num(&self, v: &Out, span: Span, what: &str) -> Result<()> {
        if v.ty.is_num() {
            Ok(())
        } else if v.ty.non_null().is_num() {
            err_help(
                span,
                format!("{what} needs a number, but this might be null"),
                "check it first, or use `?? 0`",
            )
        } else {
            err(span, format!("{what} needs a number, not {}", v.ty.describe()))
        }
    }

    /// The value as a PHP string expression, safe to join with `.`.
    fn to_string_php(&self, v: &Out, span: Span) -> Result<String> {
        Ok(match &v.ty {
            t if t.is_str() => v.wrapped(),
            Ty::Num | Ty::Date => format!("\\Zero\\Js::numStr({})", v.php),
            Ty::Builder(_) | Ty::Promise(_) => return err(span, "this value needs `await` first"),
            _ => format!("\\Zero\\Js::str({})", v.php),
        })
    }

    fn binary(&mut self, op: BinOp, a: Out, b: Out, span: Span) -> Result<Out> {
        Ok(match op {
            BinOp::Add => {
                if a.ty.is_num() && b.ty.is_num() {
                    Out::new(format!("{} + {}", a.wrapped(), b.wrapped()), Ty::Num)
                } else if a.ty.is_str() || b.ty.is_str() {
                    let (x, y) = (self.to_string_php(&a, span)?, self.to_string_php(&b, span)?);
                    Out::new(format!("{x} . {y}"), Ty::Str)
                } else {
                    return err_help(
                        span,
                        format!("`+` between {} and {} is ambiguous", a.ty.describe(), b.ty.describe()),
                        "make both sides numbers, or use a template literal for text",
                    );
                }
            }
            BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::Exp => {
                let sym = match op {
                    BinOp::Sub => "-",
                    BinOp::Mul => "*",
                    BinOp::Div => "/",
                    BinOp::Rem => "%",
                    _ => "**",
                };
                self.need_num(&a, span, &format!("`{sym}`"))?;
                self.need_num(&b, span, &format!("`{sym}`"))?;
                match op {
                    BinOp::Div => Out::atom(format!("fdiv({}, {})", a.php, b.php), Ty::Num),
                    BinOp::Rem => Out::atom(format!("fmod({}, {})", a.php, b.php), Ty::Num),
                    _ => Out::new(format!("{} {sym} {}", a.wrapped(), b.wrapped()), Ty::Num),
                }
            }
            BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                let sym = match op {
                    BinOp::Lt => "<",
                    BinOp::Le => "<=",
                    BinOp::Gt => ">",
                    _ => ">=",
                };
                if a.ty.is_num() && b.ty.is_num() {
                    Out::new(format!("{} {sym} {}", a.wrapped(), b.wrapped()), Ty::Bool)
                } else if a.ty.is_str() && b.ty.is_str() {
                    // JS compares strings by UTF-16 code units; for UTF-8 that matches byte order
                    // except across surrogate pairs, which strcmp handles consistently enough.
                    Out::new(format!("strcmp({}, {}) {sym} 0", a.php, b.php), Ty::Bool)
                } else {
                    return err(
                        span,
                        format!(
                            "can't compare {} with {} using `{sym}`",
                            a.ty.describe(),
                            b.ty.describe()
                        ),
                    );
                }
            }
            BinOp::Eq | BinOp::Ne => {
                self.check_identity_eq(&a, &b, span)?;
                let eq = self.strict_eq(&a, &b);
                if op == BinOp::Eq {
                    Out::new(eq, Ty::Bool)
                } else {
                    Out::new(format!("!({eq})"), Ty::Bool)
                }
            }
        })
    }

    /// `===` on arrays/objects compares identity in JS; PHP arrays have none.
    fn check_identity_eq(&self, a: &Out, b: &Out, span: Span) -> Result<()> {
        let by_ref = |t: &Ty| {
            matches!(
                t.non_null(),
                Ty::Array(_) | Ty::Tuple(_) | Ty::ArrayLiteral(_) | Ty::Obj(_) | Ty::Map(_)
            )
        };
        if by_ref(&a.ty) && by_ref(&b.ty) {
            return err_help(
                span,
                "`===` between arrays or objects compares identity, which compiled code can't preserve",
                "compare a field (`a.id === b.id`), or check for null (`a === null`)",
            );
        }
        Ok(())
    }

    fn strict_eq(&self, a: &Out, b: &Out) -> String {
        let num_like = |t: &Ty| t.non_null().is_num();
        if num_like(&a.ty) && num_like(&b.ty) && !(a.ty.is_nullable() || b.ty.is_nullable()) {
            // int 1 and float 1.0 are the same JS number.
            format!("{} == {}", a.wrapped(), b.wrapped())
        } else if num_like(&a.ty) || num_like(&b.ty) || a.ty == Ty::Unknown || b.ty == Ty::Unknown {
            format!("\\Zero\\Js::strictEq({}, {})", a.php, b.php)
        } else {
            format!("{} === {}", a.wrapped(), b.wrapped())
        }
    }

    fn ident(&mut self, n: &str, span: Span) -> Result<Out> {
        match self.resolve(n, span)? {
            Resolved::Local(l) => Ok(Out {
                php: l.php.clone(),
                ty: l.ty,
                place: Some(l.php),
                atomic: true,
                helper: None,
            }),
            Resolved::Value(v, b) => self.captured(n, v, &b, span),
            Resolved::Global(g) => err(
                span,
                format!("`{g}` can't be used as a value; call one of its functions"),
            ),
        }
    }

    /// A name captured from the config's build-time scope.
    fn captured(&mut self, n: &str, v: Value, b: &Binding, span: Span) -> Result<Out> {
        if b.mutable && b.module_level {
            return err_help(
                span,
                format!("hooks can't read `{n}`: it's a module-level `let`"),
                "make it a `const`; each request starts fresh in PHP",
            );
        }
        match &v {
            Value::Closure(c) => {
                let key = closure_key(c);
                let helper_key = (key, self.fx().no_db);
                let name = match self.helpers.get(&helper_key) {
                    Some(n) => n.clone(),
                    None => {
                        let name = self.unique_name(c.func.name.as_deref().unwrap_or(n));
                        self.helpers.insert(helper_key, name.clone());
                        self.compile_helper_now(c, &name)?;
                        name
                    }
                };
                let Some(ty) = self.helper_types.get(&key).cloned() else {
                    return err_help(
                        span,
                        format!("`{n}` calls itself, so it needs a return type"),
                        format!("annotate it: `function {n}(...): number`"),
                    );
                };
                let mut out = Out::atom(format!("'\\\\ZeroApp\\\\{name}'"), ty);
                out.helper = Some(format!("\\ZeroApp\\{name}"));
                Ok(out)
            }
            Value::Collection(c) => {
                let t = self.table_of(c, span)?;
                Ok(Out::atom(php_str(&t), Ty::Collection(t)))
            }
            Value::Builtin(Builtin::Db) => {
                if self.fx().no_db {
                    return err_help(
                        span,
                        "access rules can't query; put that in a hook",
                        "return a filter instead, e.g. `{ ownerId: ctx.user?.id ?? -1 }`",
                    );
                }
                Ok(Out::atom("\\Zero\\db()", Ty::Db))
            }
            Value::Builtin(Builtin::Env | Builtin::Once | Builtin::Jobs) | Value::Env(_) => err_help(
                span,
                "not implemented until lane D",
                "runtime enqueue/once/env calls become available in lane D",
            ),
            Value::Builtin(Builtin::HttpError) => err(span, "use `throw new HttpError(status, code, message)`"),
            Value::Builtin(_)
            | Value::Column(_)
            | Value::ColRef(_)
            | Value::Relation(_)
            | Value::Action(_)
            | Value::Job(_)
            | Value::FileBucket(_)
            | Value::Bound(..) => err(
                span,
                format!("`{n}` is {}, which only exists while the config is built", v.describe()),
            ),
            Value::Regex(p, f) => Ok(Out::atom(
                format!("\\Zero\\Js::re({}, {})", php_str(p), php_str(f)),
                Ty::Regex,
            )),
            data => {
                validate_captured_data(data, span, &mut HashSet::new())?;
                let Some(json) = to_json(data) else {
                    return err(
                        span,
                        format!("`{n}` is {}, which can't be used in PHP", data.describe()),
                    );
                };
                let ty = match &b.ann {
                    Some((ann, module)) => self.resolve_ann(ann, *module, &HashMap::new())?,
                    None => ty_of_json(&json),
                };
                Ok(Out::atom(php_json(&json), ty))
            }
        }
    }

    fn compile_helper_now(&mut self, c: &Rc<Closure>, name: &str) -> Result<()> {
        // Compile the helper before its caller so its return type is known.
        let no_db = self.fx().no_db;
        let saved_out = std::mem::take(&mut self.output);
        let saved_fx = self.fx.take();
        let r = self.compile_function(c, name, None, None, no_db);
        self.fx = saved_fx;
        let helper_src = std::mem::replace(&mut self.output, saved_out);
        self.output.push_str(&helper_src);
        r
    }

    fn closure_expr(&mut self, f: &Rc<Func>) -> Result<Out> {
        self.closure_with_types(f, &[])
    }

    fn closure_body(&mut self, f: &Func, param_tys: &[Ty]) -> Result<(String, String)> {
        let mut params = Vec::new();
        let mut body = String::new();
        for (i, p) in f.params.iter().enumerate() {
            match &p.pat {
                Pat::Id(n, _) => {
                    let php = self.declare_local(n, param_tys[i].clone(), true);
                    let default = if p.optional || p.default.is_some() {
                        " = null"
                    } else {
                        ""
                    };
                    params.push(format!("{php}{default}"));
                }
                pat => {
                    let tmp = format!("$__arg{i}");
                    params.push(tmp.clone());
                    self.bind_pattern(pat, &tmp, &param_tys[i], true, &mut body, 2)?;
                }
            }
        }
        match &f.body {
            FnBody::Expr(e) => {
                let v = self.expr(e)?;
                let v = self.finish_value(v, e.span)?;
                self.note_return(&v.ty, e.span)?;
                let _ = writeln!(body, "{}return {};", pad(2), v.php);
            }
            FnBody::Block(stmts) => {
                body.push_str(&self.block(stmts, 2)?);
                self.note_fallthrough(stmts, f.span)?;
            }
        }
        Ok((params.join(", "), body))
    }

    /// Compiles a callback argument with its parameters typed from context.
    fn callback(&mut self, e: &Expr, params: &[Ty]) -> Result<Out> {
        if let ExprKind::Func(f) = &e.kind {
            return self.closure_with_types(f, params);
        }
        let v = self.expr(e)?;
        if !matches!(v.ty, Ty::Fn(..)) {
            return err(e.span, format!("expected a function, got {}", v.ty.describe()));
        }
        Ok(v)
    }

    fn closure_with_types(&mut self, f: &Rc<Func>, params: &[Ty]) -> Result<Out> {
        let module = f.module;
        let mut param_tys = Vec::new();
        for (i, p) in f.params.iter().enumerate() {
            let t = match &p.ann {
                Some(a) => self.resolve_ann(a, module, &HashMap::new())?,
                None => match params.get(i) {
                    Some(t) => widen_literal_array(t),
                    None => return err(p.span, "this callback parameter is never given a value"),
                },
            };
            param_tys.push(t);
        }
        let mut inner = FnCtx {
            scopes: vec![HashMap::new()],
            is_async: f.is_async,
            ret: None,
            returns: Vec::new(),
            diverging: HashSet::new(),
            exhaustive_switches: HashSet::new(),
            env: self.fx().env.clone(),
            module,
            by_ref: HashSet::new(),
            declared: Vec::new(),
            captures: Some(Vec::new()),
            outer: None,
            tmp: 0,
            switch_depth: 0,
            no_db: self.fx().no_db,
            access: None,
        };
        if f.is_async {
            return err_help(
                f.span,
                "async callbacks aren't supported",
                "use a `for ... of` loop with `await` inside",
            );
        }
        if let Some(r) = &f.ret {
            inner.ret = Some(self.resolve_ann(r, module, &HashMap::new())?);
        }
        let outer = self.fx.take().expect("fn");
        inner.outer = Some(Box::new(outer));
        self.fx = Some(inner);
        check_aliasing(f)?;
        let result = self.closure_body(f, &param_tys);
        let mut inner = self.fx.take().expect("inner");
        self.fx = Some(*inner.outer.take().expect("outer"));
        let (params_php, body) = result?;
        let ret = inner.ret.clone().unwrap_or_else(|| Ty::union(inner.returns.clone()));
        let caps = inner.captures.take().unwrap_or_default();
        let uses: Vec<String> = caps
            .iter()
            .map(|(n, m)| format!("{}${n}", if *m { "&" } else { "" }))
            .collect();
        let use_clause = if uses.is_empty() {
            String::new()
        } else {
            format!(" use ({})", uses.join(", "))
        };
        // Single-expression arrows become PHP arrow functions (auto-capture by value).
        let php = match (&f.body, caps.iter().any(|(_, m)| *m)) {
            (FnBody::Expr(_), false) => {
                let ret_line = body
                    .trim()
                    .trim_start_matches("return ")
                    .trim_end_matches(';')
                    .to_string();
                if body.trim().lines().count() == 1 {
                    format!("fn({params_php}) => {ret_line}")
                } else {
                    format!("function ({params_php}){use_clause} {{\n{body}{}}}", pad(1))
                }
            }
            _ => format!("function ({params_php}){use_clause} {{\n{body}{}}}", pad(1)),
        };
        Ok(Out::atom(php, Ty::Fn(param_tys, Box::new(ret))))
    }

    fn assign(&mut self, op: Option<AssignOp>, target: &Expr, value: &Expr, span: Span) -> Result<Out> {
        let t = self.place(target)?;
        let v = self.expr(value)?;
        let v = self.finish_value(v, value.span)?;
        match op {
            None => {
                if !assignable(&v.ty, &t.ty) {
                    return err(
                        span,
                        format!(
                            "can't assign {} to something of type {}",
                            v.ty.describe(),
                            t.ty.describe()
                        ),
                    );
                }
                if let ExprKind::Ident(n) = &target.kind {
                    // Assignment narrows: `x = 5` makes x a number until reassigned.
                    let declared = t.ty.clone();
                    let _ = declared;
                    let _ = n;
                }
                Ok(Out::new(format!("{} = {}", t.php, v.php), v.ty))
            }
            Some(AssignOp::Bin(b)) => {
                let r = self.binary(b, t.clone(), v, span)?;
                if !assignable(&r.ty, &t.ty) {
                    return err(
                        span,
                        format!(
                            "can't assign {} to something of type {}",
                            r.ty.describe(),
                            t.ty.describe()
                        ),
                    );
                }
                Ok(Out::new(format!("{} = {}", t.php, r.php), r.ty))
            }
            Some(AssignOp::Log(LogOp::Nullish)) => Ok(Out::new(
                format!("{} ??= {}", t.php, v.php),
                Ty::union([t.ty.non_null(), v.ty]),
            )),
            Some(AssignOp::Log(l)) => {
                let cond = self.truthy(&t);
                let keep = if l == LogOp::Or {
                    cond
                } else {
                    format!("!{}", paren(&cond))
                };
                Ok(Out::new(
                    format!("{} = {} ? {} : {}", t.php, paren(&keep), t.php, v.wrapped()),
                    Ty::union([t.ty, v.ty]),
                ))
            }
        }
    }

    /// An assignable PHP place.
    fn place(&mut self, target: &Expr) -> Result<Out> {
        match &target.kind {
            ExprKind::Ident(n) => match self.resolve(n, target.span)? {
                Resolved::Local(l) => {
                    if !l.mutable {
                        return err(target.span, format!("can't assign to `{n}`: it's a constant"));
                    }
                    Ok(Out {
                        php: l.php.clone(),
                        ty: l.ty,
                        place: Some(l.php),
                        atomic: true,
                        helper: None,
                    })
                }
                Resolved::Value(..) => err_help(
                    target.span,
                    format!("hooks can't change `{n}`: it belongs to the config, not the request"),
                    "keep request state in local variables",
                ),
                Resolved::Global(g) => err(target.span, format!("can't assign to `{g}`")),
            },
            ExprKind::Member {
                obj, prop, prop_span, ..
            } => {
                let o = self.place(obj)?;
                let Some((ft, _)) = o.ty.non_null().field(prop) else {
                    return Err(self.no_field(&o.ty, prop, *prop_span));
                };
                if o.ty.is_nullable() {
                    return err(target.span, format!("can't set `{prop}`: the object might be null"));
                }
                let php = format!("{}[{}]", o.php, php_str(prop));
                Ok(Out {
                    php: php.clone(),
                    ty: ft,
                    place: Some(php),
                    atomic: true,
                    helper: None,
                })
            }
            ExprKind::Index { obj, index, .. } => {
                let o = self.place(obj)?;
                let i = self.expr(index)?;
                let (php, ty) = match o.ty.non_null() {
                    Ty::Array(t) if i.ty.is_num() => (format!("{}[(int) {}]", o.php, i.wrapped()), *t),
                    Ty::Map(t) if i.ty.is_str() => (format!("{}[{}]", o.php, i.php), *t),
                    other => {
                        return err(
                            target.span,
                            format!("can't assign into {} with {}", other.describe(), i.ty.describe()),
                        );
                    }
                };
                Ok(Out {
                    php: php.clone(),
                    ty,
                    place: Some(php),
                    atomic: true,
                    helper: None,
                })
            }
            ExprKind::NonNull(x) | ExprKind::As(x, _) => self.place(x),
            _ => err(target.span, "can't assign to this"),
        }
    }

    fn no_field(&self, t: &Ty, prop: &str, span: Span) -> Diag {
        let mut d = Diag::new(span, format!("{} has no field `{prop}`", t.non_null().describe()));
        if let Ty::Obj(f) = t.non_null()
            && let Some(s) = suggest(prop, f.keys().map(String::as_str))
        {
            d = d.help(format!("did you mean `{s}`?"));
        }
        d
    }

    fn member(&mut self, obj: &Expr, prop: &str, optional: bool, prop_span: Span, span: Span) -> Result<Out> {
        // Namespaces: Math.PI etc.
        if let ExprKind::Ident(n) = &obj.kind
            && let Ok(Resolved::Global(g)) = self.resolve(n, obj.span)
        {
            return match (g, prop) {
                ("Math", "PI") => Ok(Out::atom("M_PI", Ty::Num)),
                ("Math", "E") => Ok(Out::atom("M_E", Ty::Num)),
                ("Number", "MAX_SAFE_INTEGER") => Ok(Out::atom("9007199254740991", Ty::Num)),
                ("Number", "MIN_SAFE_INTEGER") => Ok(Out::atom("-9007199254740991", Ty::Num)),
                _ => err(span, format!("`{g}.{prop}` isn't supported")),
            };
        }
        let o = self.expr(obj)?;
        match &o.ty {
            Ty::Db if prop == "query" => return Ok(Out::atom("\\Zero\\db()", Ty::DbQuery)),
            Ty::DbQuery => {
                return match self.schema.by_key(prop) {
                    Some(c) => Ok(Out::atom("\\Zero\\db()", Ty::QueryColl(c.table.clone()))),
                    None => {
                        let mut d = Diag::new(
                            prop_span,
                            format!("`db.query.{prop}` doesn't match a collection in `schema`"),
                        );
                        let keys: Vec<&str> = self.schema.collections.values().map(|c| c.key.as_str()).collect();
                        if let Some(s) = suggest(prop, keys) {
                            d = d.help(format!("did you mean `{s}`?"));
                        }
                        Err(d)
                    }
                };
            }
            _ => {}
        }
        let mut o = self.finish_value(o, obj.span)?;
        if let Some(path) = self.path_of(obj)
            && let Some(t) = self.narrowed_path(&path)
        {
            o.ty = t;
        }
        let base = o.ty.non_null();
        if o.ty.is_nullable() && !optional {
            return err_help(
                span,
                format!("can't read `{prop}`: this might be null ({})", o.ty.describe()),
                "check it first, or use `?.`",
            );
        }
        let suffix_null = |t: Ty| {
            if optional && o.ty.is_nullable() {
                t.nullable()
            } else {
                t
            }
        };
        // `x?.length` on a nullable value: evaluate once, short-circuit to null.
        let guarded = |c: &mut Self, f: &dyn Fn(&str) -> String| {
            if optional && o.ty.is_nullable() {
                let tmp = c.tmp_var();
                format!("(({tmp} = {}) === null ? null : {})", o.php, f(&tmp))
            } else {
                f(&o.php)
            }
        };
        Ok(match (&base, prop) {
            (t, "length") if t.is_str() => {
                let php = guarded(self, &|x| format!("\\Zero\\Js::length({x})"));
                Out::atom(php, suffix_null(Ty::Num))
            }
            (Ty::Array(_) | Ty::Tuple(_) | Ty::ArrayLiteral(_), "length") => {
                let php = guarded(self, &|x| format!("count({x})"));
                Out::atom(php, suffix_null(Ty::Num))
            }
            (Ty::Error, "message") => Out::atom(format!("{}->getMessage()", o.wrapped()), Ty::Str),
            (Ty::Regex, "source" | "flags") => Out::atom(format!("{}->{prop}", o.wrapped()), Ty::Str),
            (Ty::Obj(_) | Ty::Map(_) | Ty::Union(_), _) => {
                let Some((ft, opt_field)) = base.field(prop) else {
                    if matches!(base, Ty::Union(_)) {
                        return err(prop_span, format!("{} has no property `{prop}`", base.describe()));
                    }
                    return Err(self.no_field(&o.ty, prop, prop_span));
                };
                let map = matches!(base, Ty::Map(_));
                let php = if optional && o.ty.is_nullable() || opt_field || map {
                    format!("({}[{}] ?? null)", o.php, php_str(prop))
                } else {
                    format!("{}[{}]", o.php, php_str(prop))
                };
                let ft = if map || opt_field { ft.nullable() } else { ft };
                let place = o.place.as_ref().map(|p| format!("{p}[{}]", php_str(prop)));
                Out {
                    php,
                    ty: suffix_null(ft),
                    place,
                    atomic: true,
                    helper: None,
                }
            }
            (Ty::Unknown, _) => {
                return err_help(
                    span,
                    format!("can't read `{prop}` of a value with unknown shape"),
                    "give it a type, e.g. `json().$type<{ ... }>()`",
                );
            }
            _ => return err(prop_span, format!("{} has no property `{prop}`", base.describe())),
        })
    }

    fn index(&mut self, obj: &Expr, index: &Expr, optional: bool, span: Span) -> Result<Out> {
        let o = self.expr(obj)?;
        let o = self.finish_value(o, obj.span)?;
        let i = self.expr(index)?;
        if o.ty.is_nullable() && !optional {
            return err_help(
                span,
                format!("can't index this: it might be null ({})", o.ty.describe()),
                "check it first, or use `?.[]`",
            );
        }
        let base = o.ty.non_null();
        let wrap = |t: Ty| {
            if optional && o.ty.is_nullable() {
                t.nullable()
            } else {
                t
            }
        };
        Ok(match (&base, &i.ty) {
            (Ty::Array(t), it) if it.is_num() => {
                Out::atom(format!("({}[{}] ?? null)", o.php, int_index(&i)), wrap((**t).clone()))
            }
            (Ty::Tuple(ts) | Ty::ArrayLiteral(ts), _) => match &index.kind {
                ExprKind::Num(n) if n.fract() == 0.0 && *n >= 0.0 => {
                    let t = ts.get(*n as usize).cloned().unwrap_or(Ty::Null);
                    let place = o.place.as_ref().map(|p| format!("{p}[{}]", *n as usize));
                    Out {
                        php: format!("{}[{}]", o.php, *n as usize),
                        ty: wrap(t),
                        place,
                        atomic: true,
                        helper: None,
                    }
                }
                _ if i.ty.is_num() => Out::atom(
                    format!("({}[{}] ?? null)", o.php, int_index(&i)),
                    wrap(Ty::union(ts.clone()).nullable()),
                ),
                _ => return err(index.span, "tuples are indexed by number"),
            },
            (Ty::Map(t), key_ty) if key_ty.is_str() => Out::atom(
                format!("({}[{}] ?? null)", o.php, i.php),
                wrap((**t).clone().nullable()),
            ),
            (Ty::Obj(fields), i) if i.is_str() => {
                if let ExprKind::Str(k) = &index.kind {
                    return self.member(obj, k, optional, index.span, span);
                }
                let _ = fields;
                return err_help(
                    index.span,
                    "dynamic keys on an object with fixed fields aren't supported",
                    "use a `Record<string, T>` or a `switch`",
                );
            }
            (s, it) if s.is_str() && it.is_num() => Out::atom(
                format!("\\Zero\\Js::strAt({}, {})", o.php, i.php),
                wrap(Ty::Str.nullable()),
            ),
            _ => {
                return err(
                    span,
                    format!("can't index {} with {}", base.describe(), i.ty.describe()),
                );
            }
        })
    }

    fn await_expr(&mut self, x: &Expr, span: Span) -> Result<Out> {
        if !self.fx().is_async {
            return err_help(
                span,
                "`await` only works in async functions",
                "mark the function `async`",
            );
        }
        let v = self.expr(x)?;
        Ok(match v.ty {
            Ty::Promise(t) => Out { ty: *t, ..v },
            Ty::Builder(b) => Out::new(b.php(), b.result(self.schema)),
            other => {
                return err_help(
                    span,
                    format!("awaiting {} does nothing", other.describe()),
                    "only await Zero database calls and your own async functions",
                );
            }
        })
    }

    fn new_expr(&mut self, callee: &Expr, args: &[ArrEl], span: Span) -> Result<Out> {
        let ExprKind::Ident(n) = &callee.kind else {
            return err(span, "`new` only works with Date, Error, and HttpError");
        };
        match self.resolve(n, callee.span)? {
            Resolved::Global("Date") => {
                let argv = self.plain_args(args)?;
                Ok(match argv.as_slice() {
                    [] => Out::atom("\\Zero\\Js::now()", Ty::Date),
                    [a] => Out::atom(format!("\\Zero\\Js::date({})", a.php), Ty::Date),
                    _ => {
                        return err(
                            span,
                            "`new Date(y, m, d)` isn't supported; use an ISO string or a number",
                        );
                    }
                })
            }
            Resolved::Global(g @ ("Error" | "TypeError" | "RangeError")) => {
                let argv = self.plain_args(args)?;
                let msg = match argv.first() {
                    Some(m) => self.to_string_php(m, span)?,
                    None => "''".into(),
                };
                Ok(Out::new(
                    format!("new \\Zero\\JsError({msg}, {})", php_str(g)),
                    Ty::Error,
                ))
            }
            Resolved::Value(Value::Builtin(Builtin::HttpError), _) => err(
                span,
                "create HttpError directly in a `throw`: `throw new HttpError(404, \"not_found\", \"...\")`",
            ),
            _ => err(span, format!("`new {n}` isn't supported")),
        }
    }

    fn plain_args(&mut self, args: &[ArrEl]) -> Result<Vec<Out>> {
        let mut out = Vec::new();
        for a in args {
            match a {
                ArrEl::Item(x) => {
                    let v = self.expr(x)?;
                    out.push(self.finish_value(v, x.span)?);
                }
                ArrEl::Spread(x) => return err(x.span, "spread arguments aren't supported in this call"),
            }
        }
        Ok(out)
    }

    fn arg<'e>(&self, args: &'e [ArrEl], i: usize, span: Span, what: &str) -> Result<&'e Expr> {
        match args.get(i) {
            Some(ArrEl::Item(x)) => Ok(x),
            Some(ArrEl::Spread(x)) => err(x.span, "spread arguments aren't supported in this call"),
            None => err(span, format!("missing {what}")),
        }
    }

    fn call(&mut self, callee: &Expr, args: &[ArrEl], optional: bool, span: Span) -> Result<Out> {
        if optional {
            return err(span, "optional calls (`f?.()`) aren't supported");
        }
        if let ExprKind::Ident(n) = &callee.kind
            && let Resolved::Value(Value::Builtin(Builtin::Once), _) = self.resolve(n, callee.span)?
        {
            let key = self.arg(args, 0, span, "once")?;
            if !self.expr(key)?.ty.is_str() {
                return err_help(key.span, "once key must be a string", "use a stable string key");
            }
        }
        match &callee.kind {
            ExprKind::Member {
                obj,
                prop,
                optional: opt,
                prop_span,
            } => {
                // Static functions on globals: Math.max, Object.keys, ...
                if let ExprKind::Ident(n) = &obj.kind
                    && let Ok(Resolved::Global(g)) = self.resolve(n, obj.span)
                {
                    return self.static_call(g, prop, args, span);
                }
                let recv = self.expr(obj)?;
                self.method_call(recv, obj.span, prop, *opt, *prop_span, args, span)
            }
            ExprKind::Ident(n) => {
                if let Resolved::Global(g) = self.resolve(n, callee.span)? {
                    return self.global_call(g, args, span);
                }
                let f = self.ident(n, callee.span)?;
                self.call_value(f, args, span, callee.span)
            }
            _ => {
                let f = self.expr(callee)?;
                self.call_value(f, args, span, callee.span)
            }
        }
    }

    fn call_value(&mut self, f: Out, args: &[ArrEl], span: Span, callee_span: Span) -> Result<Out> {
        let Ty::Fn(params, ret) = f.ty.clone() else {
            return err(callee_span, format!("{} isn't a function", f.ty.describe()));
        };
        let mut argv = Vec::new();
        for (i, a) in args.iter().enumerate() {
            let ArrEl::Item(x) = a else {
                return err(span, "spread arguments aren't supported in calls");
            };
            let want = params.get(i).cloned();
            let v = match (&x.kind, &want) {
                (ExprKind::Func(_), Some(Ty::Fn(ps, _))) => self.callback(x, ps)?,
                _ => {
                    let v = self.expr(x)?;
                    self.finish_value(v, x.span)?
                }
            };
            if let Some(w) = &want
                && !assignable(&v.ty, w)
            {
                return err(
                    x.span,
                    format!(
                        "this argument is {}, but the function expects {}",
                        v.ty.describe(),
                        w.describe()
                    ),
                );
            }
            if want.is_none() {
                return err(x.span, "too many arguments");
            }
            argv.push(v.php);
        }
        let php = match &f.helper {
            Some(name) => format!("{name}({})", argv.join(", ")),
            None => format!("{}({})", f.wrapped(), argv.join(", ")),
        };
        Ok(Out::new(php, *ret))
    }

    fn global_call(&mut self, g: &str, args: &[ArrEl], span: Span) -> Result<Out> {
        let argv = self.plain_args(args)?;
        let a0 = argv.first();
        Ok(match (g, a0) {
            ("String", Some(v)) => Out::new(self.to_string_php(v, span)?, Ty::Str),
            ("Number", Some(v)) => {
                if v.ty.is_num() {
                    v.clone()
                } else {
                    Out::atom(format!("\\Zero\\Js::toNumber({})", v.php), Ty::Num)
                }
            }
            ("Boolean", Some(v)) => Out::new(self.truthy(v), Ty::Bool),
            ("parseInt", Some(v)) => Out::atom(
                format!(
                    "\\Zero\\Js::parseInt({})",
                    argv.iter().map(|a| a.php.clone()).collect::<Vec<_>>().join(", ")
                ),
                Ty::Num,
            )
            .checked_str(v, span)?,
            ("parseFloat", Some(v)) => {
                Out::atom(format!("\\Zero\\Js::parseFloat({})", v.php), Ty::Num).checked_str(v, span)?
            }
            ("isNaN", Some(v)) => Out::atom(format!("is_nan((float) \\Zero\\Js::toNumber({}))", v.php), Ty::Bool),
            (
                "fetch" | "process" | "require" | "eval" | "Function" | "setTimeout" | "crypto" | "globalThis"
                | "Promise",
                _,
            ) => {
                return err(span, format!("`{g}` isn't available in Zero code"));
            }
            _ => return err(span, format!("`{g}(...)` isn't supported")),
        })
    }

    fn static_call(&mut self, g: &str, m: &str, args: &[ArrEl], span: Span) -> Result<Out> {
        if (g, m) == ("Array", "from") {
            let src = self.arg(args, 0, span, "an argument")?;
            if let ExprKind::Object(props) = &src.kind
                && let [Prop::KV(PropKey::Static(k), len)] = props.as_slice()
                && k == "length"
            {
                let n = self.expr(len)?;
                self.need_num(&n, len.span, "`length`")?;
                let f = self.arg(args, 1, span, "a function")?;
                let cb = self.callback(f, &[Ty::Null, Ty::Num])?;
                let Ty::Fn(_, ret) = &cb.ty else { unreachable!() };
                let ret = (**ret).clone();
                return Ok(Out::atom(
                    format!(
                        "\\Zero\\Js::range((int) {}, fn($i) => ({})(null, $i))",
                        n.wrapped(),
                        cb.php
                    ),
                    Ty::Array(Box::new(ret)),
                ));
            }
            let v = self.expr(src)?;
            let Ty::Array(el) = v.ty.non_null() else {
                return err(src.span, "Array.from needs an array or `{ length: n }`");
            };
            if let Some(ArrEl::Item(f)) = args.get(1) {
                let cb = self.callback(f, &[(*el).clone(), Ty::Num])?;
                let Ty::Fn(_, ret) = &cb.ty else { unreachable!() };
                return Ok(Out::atom(
                    format!("\\Zero\\Js::map({}, {})", v.php, cb.php),
                    Ty::Array(ret.clone()),
                ));
            }
            return Ok(Out::atom(format!("array_values({})", v.php), Ty::Array(el)));
        }
        let argv = self.plain_args(args)?;
        let php_args = || argv.iter().map(|a| a.php.clone()).collect::<Vec<_>>().join(", ");
        let all_num = |what: &str| -> Result<()> {
            for (i, a) in argv.iter().enumerate() {
                if !a.ty.is_num() {
                    return err(
                        span,
                        format!("argument {} of {what} must be a number, not {}", i + 1, a.ty.describe()),
                    );
                }
            }
            Ok(())
        };
        let a0 = argv.first();
        Ok(match (g, m) {
            ("Math", "max" | "min") => {
                all_num(&format!("Math.{m}"))?;
                Out::atom(format!("\\Zero\\Js::{m}({})", php_args()), Ty::Num)
            }
            ("Math", "floor" | "ceil" | "abs" | "sqrt" | "trunc" | "round" | "sign" | "pow" | "log" | "exp") => {
                all_num(&format!("Math.{m}"))?;
                let x = php_args();
                let php = match m {
                    "floor" => format!("floor({x})"),
                    "ceil" => format!("ceil({x})"),
                    "abs" => format!("abs({x})"),
                    "sqrt" => format!("sqrt({x})"),
                    "trunc" => format!("(({x}) < 0 ? ceil({x}) : floor({x}))"),
                    "round" => format!("floor(({x}) + 0.5)"),
                    "sign" => format!("(({x}) <=> 0)"),
                    "pow" => format!(
                        "({}) ** ({})",
                        argv[0].php,
                        argv.get(1).map(|a| a.php.as_str()).unwrap_or("NAN")
                    ),
                    "log" => format!("log({x})"),
                    _ => format!("exp({x})"),
                };
                Out::atom(php, Ty::Num)
            }
            ("Math", "random") => Out::atom("\\Zero\\Js::random()", Ty::Num),
            ("Date", "now") => Out::atom("\\Zero\\Js::now()", Ty::Num),
            ("Object", "keys") => Out::atom(
                format!("\\Zero\\Js::keys({})", self.obj_arg(a0, span)?),
                Ty::Array(Box::new(Ty::Str)),
            ),
            ("Object", "values") => {
                let t = obj_values_ty(a0.map(|a| &a.ty));
                Out::atom(
                    format!("\\Zero\\Js::values({})", self.obj_arg(a0, span)?),
                    Ty::Array(Box::new(t)),
                )
            }
            ("Object", "entries") => {
                let t = obj_values_ty(a0.map(|a| &a.ty));
                Out::atom(
                    format!("\\Zero\\Js::entries({})", self.obj_arg(a0, span)?),
                    Ty::Array(Box::new(Ty::Tuple(vec![Ty::Str, t]))),
                )
            }
            ("Object", "fromEntries") => {
                let t = match a0.map(|a| a.ty.non_null()) {
                    Some(Ty::Array(el)) => match *el {
                        Ty::Tuple(ts) | Ty::ArrayLiteral(ts) if ts.len() == 2 => ts[1].clone(),
                        _ => Ty::Unknown,
                    },
                    _ => return err(span, "Object.fromEntries needs an array of [key, value] pairs"),
                };
                Out::atom(format!("\\Zero\\Js::fromEntries({})", php_args()), Ty::Map(Box::new(t)))
            }
            ("Object", "hasOwn") => Out::atom(format!("\\Zero\\Js::hasOwn({})", php_args()), Ty::Bool),
            ("Array", "isArray") => Out::atom(
                format!(
                    "(is_array({0}) && array_is_list({0}))",
                    a0.map(|a| a.php.clone()).unwrap_or_default()
                ),
                Ty::Bool,
            ),
            ("Number", "isInteger") => Out::atom(format!("\\Zero\\Js::isInteger({})", php_args()), Ty::Bool),
            ("Number", "isFinite") => Out::atom(format!("\\Zero\\Js::isFinite({})", php_args()), Ty::Bool),
            ("Number", "parseInt") => Out::atom(format!("\\Zero\\Js::parseInt({})", php_args()), Ty::Num),
            ("Number", "parseFloat") => Out::atom(format!("\\Zero\\Js::parseFloat({})", php_args()), Ty::Num),
            ("JSON", "stringify") => {
                let t = Ty::Str;
                if argv.len() > 1 {
                    let indent = argv.get(2).map(|a| a.php.clone()).unwrap_or_else(|| "null".into());
                    Out::atom(format!("\\Zero\\Js::jsonStringify({}, {indent})", argv[0].php), t)
                } else {
                    Out::atom(format!("\\Zero\\Js::jsonStringify({})", php_args()), t)
                }
            }
            ("JSON", "parse") => Out::atom(format!("\\Zero\\Js::jsonParse({})", php_args()), Ty::Unknown),
            ("console", "log" | "info" | "warn" | "error" | "debug") => {
                Out::atom(format!("\\Zero\\Js::log({}, {})", php_str(m), php_args()), Ty::Null)
            }
            _ => return err(span, format!("`{g}.{m}` isn't supported in Zero code")),
        })
    }

    fn obj_arg(&self, a: Option<&Out>, span: Span) -> Result<String> {
        match a {
            Some(v) if matches!(v.ty.non_null(), Ty::Obj(_) | Ty::Map(_)) && !v.ty.is_nullable() => Ok(v.php.clone()),
            Some(v) => err(span, format!("this needs an object, not {}", v.ty.describe())),
            None => err(span, "missing argument"),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn method_call(
        &mut self,
        recv: Out,
        recv_span: Span,
        m: &str,
        optional: bool,
        m_span: Span,
        args: &[ArrEl],
        span: Span,
    ) -> Result<Out> {
        match recv.ty.clone() {
            Ty::QueryColl(table) => return self.query_call(&table, m, args, span, m_span),
            Ty::Db => return self.db_call(m, args, span, m_span),
            Ty::Builder(b) => return self.builder_call(*b, m, args, span, m_span),
            Ty::DbQuery => return err(m_span, format!("use `db.query.<collection>.{m}(...)`")),
            _ => {}
        }
        let recv = self.finish_value(recv, recv_span)?;
        if recv.ty.is_nullable() && !optional {
            return err_help(
                recv_span,
                format!("can't call `{m}`: this might be null ({})", recv.ty.describe()),
                "check it first, or use `?.`",
            );
        }
        let base = recv.ty.non_null();
        let r = match &base {
            t if t.is_str() => self.string_method(&recv, m, args, span, m_span)?,
            Ty::Array(_) | Ty::Tuple(_) | Ty::ArrayLiteral(_) => self.array_method(&recv, m, args, span, m_span)?,
            Ty::Num => match m {
                "toFixed" => {
                    let argv = self.plain_args(args)?;
                    let d = argv
                        .first()
                        .map(|a| format!("(int) {}", a.wrapped()))
                        .unwrap_or_else(|| "0".into());
                    Out::atom(format!("\\Zero\\Js::toFixed({}, {d})", recv.php), Ty::Str)
                }
                "toString" => Out::atom(format!("\\Zero\\Js::numStr({})", recv.php), Ty::Str),
                _ => return err(m_span, format!("numbers have no method `{m}`")),
            },
            Ty::Date => match m {
                "toISOString" | "toJSON" => Out::atom(format!("\\Zero\\Js::iso({})", recv.php), Ty::Str),
                "getTime" | "valueOf" => Out {
                    ty: Ty::Num,
                    ..recv.clone()
                },
                _ => {
                    return err_help(
                        m_span,
                        format!("`Date.{m}` isn't supported"),
                        "use getTime() or toISOString()",
                    );
                }
            },
            Ty::Regex => match m {
                "test" => {
                    let argv = self.plain_args(args)?;
                    let s = argv.first().ok_or_else(|| Diag::new(span, "test() needs a string"))?;
                    if !s.ty.is_str() {
                        return err(span, format!("test() needs a string, not {}", s.ty.describe()));
                    }
                    Out::atom(format!("{}->test({})", recv.wrapped(), s.php), Ty::Bool)
                }
                _ => return err(m_span, format!("regular expressions have no method `{m}`")),
            },
            Ty::Map(_) | Ty::Obj(_) => {
                // Calling a function stored in an object field.
                let f = self.member_of_out(&recv, m, m_span)?;
                return self.call_value(f, args, span, m_span);
            }
            other => return err(m_span, format!("{} has no method `{m}`", other.describe())),
        };
        if optional && recv.ty.is_nullable() {
            let tmp = self.tmp_var();
            let php = r.php.replacen(&recv.php, &tmp, 1);
            return Ok(Out::new(
                format!("({tmp} = {}) === null ? null : {php}", recv.php),
                r.ty.nullable(),
            ));
        }
        Ok(r)
    }

    fn member_of_out(&self, o: &Out, prop: &str, span: Span) -> Result<Out> {
        let Some((t, _)) = o.ty.non_null().field(prop) else {
            return Err(self.no_field(&o.ty, prop, span));
        };
        Ok(Out::atom(format!("{}[{}]", o.php, php_str(prop)), t))
    }

    fn string_method(&mut self, s: &Out, m: &str, args: &[ArrEl], span: Span, m_span: Span) -> Result<Out> {
        if matches!(m, "replace" | "replaceAll") {
            let pat = self.expr(self.arg(args, 0, span, "a pattern")?)?;
            let rep_e = self.arg(args, 1, span, "a replacement")?;
            let rep = match &rep_e.kind {
                ExprKind::Func(_) => self.callback(rep_e, &[Ty::Str, Ty::Str, Ty::Str, Ty::Str, Ty::Str])?,
                _ => self.expr(rep_e)?,
            };
            if !(pat.ty.is_str() || pat.ty == Ty::Regex) {
                return err(
                    span,
                    format!("{m}() needs a string or regex pattern, not {}", pat.ty.describe()),
                );
            }
            return Ok(Out::atom(
                format!("\\Zero\\Js::{m}({}, {}, {})", s.php, pat.php, rep.php),
                Ty::Str,
            ));
        }
        let argv = self.plain_args(args)?;
        let a = |i: usize| argv.get(i).map(|x| x.php.clone());
        let need_str = |i: usize, c: &Self| -> Result<String> {
            match argv.get(i) {
                Some(x) if x.ty.is_str() => Ok(x.php.clone()),
                Some(x) => err(span, format!("{m}() needs a string, not {}", x.ty.describe())),
                None => {
                    let _ = c;
                    err(span, format!("{m}() needs an argument"))
                }
            }
        };
        let js = |f: &str, extra: &[Option<String>]| {
            let mut parts = vec![s.php.clone()];
            parts.extend(extra.iter().flatten().cloned());
            Out::atom(format!("\\Zero\\Js::{f}({})", parts.join(", ")), Ty::Str)
        };
        Ok(match m {
            "toLowerCase" => Out::atom(format!("mb_strtolower({})", s.php), Ty::Str),
            "toUpperCase" => Out::atom(format!("mb_strtoupper({})", s.php), Ty::Str),
            "trim" | "trimStart" | "trimEnd" => js(m, &[]),
            "includes" => Out::atom(format!("str_contains({}, {})", s.php, need_str(0, self)?), Ty::Bool),
            "startsWith" => Out::atom(format!("str_starts_with({}, {})", s.php, need_str(0, self)?), Ty::Bool),
            "endsWith" => Out::atom(format!("str_ends_with({}, {})", s.php, need_str(0, self)?), Ty::Bool),
            "indexOf" | "lastIndexOf" => {
                need_str(0, self)?;
                Out {
                    ty: Ty::Num,
                    ..js(m, &[a(0), a(1)])
                }
            }
            "slice" | "substring" | "padStart" | "padEnd" | "repeat" | "charAt" => js(m, &[a(0), a(1)]),
            "at" => Out {
                ty: Ty::Str.nullable(),
                ..js("strAt", &[a(0)])
            },
            "split" => Out {
                ty: Ty::Array(Box::new(Ty::Str)),
                ..js("split", &[a(0), a(1)])
            },
            "localeCompare" => Out {
                ty: Ty::Num,
                ..js("localeCompare", &[Some(need_str(0, self)?)])
            },
            "match" => {
                if argv.first().map(|x| &x.ty) != Some(&Ty::Regex) {
                    return err(span, "match() needs a regular expression");
                }
                Out {
                    ty: Ty::Array(Box::new(Ty::Str.nullable())).nullable(),
                    ..js("strMatch", &[a(0)])
                }
            }
            "toString" => s.clone(),
            "length" => return err(m_span, "`length` is a property: write `s.length`"),
            _ => return err(m_span, format!("strings have no method `{m}` in Zero code")),
        })
    }

    fn array_method(&mut self, a: &Out, m: &str, args: &[ArrEl], span: Span, m_span: Span) -> Result<Out> {
        let el = match a.ty.non_null() {
            Ty::Array(t) => *t,
            Ty::Tuple(ts) | Ty::ArrayLiteral(ts) => Ty::union(ts),
            _ => unreachable!(),
        };
        let cb = |c: &mut Self, extra: &[Ty]| -> Result<Out> {
            let f = c.arg(args, 0, span, "a function")?;
            let mut ps = vec![el.clone(), Ty::Num];
            ps.splice(0..0, extra.iter().cloned());
            c.callback(f, &ps)
        };
        let ret_of = |f: &Out| match &f.ty {
            Ty::Fn(_, r) => (**r).clone(),
            _ => Ty::Unknown,
        };
        // In-place mutators need an assignable variable.
        let place = || -> Result<String> {
            a.place.clone().ok_or_else(|| {
                Diag::new(
                    span,
                    format!("`{m}()` changes the array in place; call it on a variable"),
                )
            })
        };
        Ok(match m {
            "map" => {
                let f = cb(self, &[])?;
                let r = ret_of(&f);
                Out::atom(format!("\\Zero\\Js::map({}, {})", a.php, f.php), Ty::Array(Box::new(r)))
            }
            "filter" => {
                let f = cb(self, &[])?;
                Out::atom(
                    format!("\\Zero\\Js::filter({}, {})", a.php, f.php),
                    Ty::Array(Box::new(el)),
                )
            }
            "find" | "findLast" => {
                let f = cb(self, &[])?;
                Out::atom(format!("\\Zero\\Js::{m}({}, {})", a.php, f.php), el.nullable())
            }
            "findIndex" | "findLastIndex" => {
                let f = cb(self, &[])?;
                Out::atom(format!("\\Zero\\Js::{m}({}, {})", a.php, f.php), Ty::Num)
            }
            "some" | "every" => {
                let f = cb(self, &[])?;
                Out::atom(format!("\\Zero\\Js::{m}({}, {})", a.php, f.php), Ty::Bool)
            }
            "flatMap" => {
                let f = cb(self, &[])?;
                let r = match ret_of(&f) {
                    Ty::Array(t) => *t,
                    t => t,
                };
                Out::atom(
                    format!("\\Zero\\Js::flatMap({}, {})", a.php, f.php),
                    Ty::Array(Box::new(r)),
                )
            }
            "forEach" => {
                let f = cb(self, &[])?;
                let tmp = self.tmp_var();
                Out::new(
                    format!("array_map({}, {tmp} = {}, array_keys({tmp}))", f.php, a.php),
                    Ty::Null,
                )
            }
            "reduce" => {
                let init = match args.get(1) {
                    Some(ArrEl::Item(x)) => Some(self.expr(x)?),
                    Some(ArrEl::Spread(x)) => return err(x.span, "spread arguments aren't supported here"),
                    None => None,
                };
                let acc_ty = init
                    .as_ref()
                    .map(|i| widen_literal_array(&i.ty))
                    .unwrap_or_else(|| widen_literal_array(&el));
                let f = self.arg(args, 0, span, "a function")?;
                let f = self.callback(f, &[acc_ty.clone(), el.clone(), Ty::Num])?;
                let r = ret_of(&f);
                if !assignable(&r, &acc_ty) {
                    return err(
                        span,
                        format!(
                            "the reducer returns {}, but the accumulator is {}",
                            r.describe(),
                            acc_ty.describe()
                        ),
                    );
                }
                let init_php = init.map(|i| format!(", {}", i.php)).unwrap_or_default();
                Out::atom(format!("\\Zero\\Js::reduce({}, {}{init_php})", a.php, f.php), acc_ty)
            }
            "sort" | "toSorted" => {
                let f = match args.first() {
                    Some(ArrEl::Item(x)) => Some(self.callback(x, &[el.clone(), el.clone()])?),
                    _ => None,
                };
                if let Some(f) = &f
                    && !ret_of(f).is_num()
                {
                    return err(span, "the comparator must return a number");
                }
                let fp = f.map(|f| format!(", {}", f.php)).unwrap_or_default();
                // Sorting a temporary (`[...xs].sort()`) mutates nothing anyone can see.
                if m == "sort" && a.place.is_some() {
                    Out::atom(format!("\\Zero\\Js::sort({}{fp})", place()?), Ty::Array(Box::new(el)))
                } else {
                    Out::atom(format!("\\Zero\\Js::sorted({}{fp})", a.php), Ty::Array(Box::new(el)))
                }
            }
            "push" => {
                let p = place()?;
                let argv = self.plain_args(args)?;
                for x in &argv {
                    if !assignable(&x.ty, &el) && el != Ty::Never {
                        return err(
                            span,
                            format!("can't push {} into an array of {}", x.ty.describe(), el.describe()),
                        );
                    }
                }
                let items: Vec<String> = argv.iter().map(|x| x.php.clone()).collect();
                Out::atom(format!("array_push({p}, {})", items.join(", ")), Ty::Num)
            }
            "pop" => Out::atom(format!("array_pop({})", place()?), el.nullable()),
            "shift" => Out::atom(format!("array_shift({})", place()?), el.nullable()),
            "unshift" => {
                let argv = self.plain_args(args)?;
                Out::atom(
                    format!(
                        "array_unshift({}, {})",
                        place()?,
                        argv.iter().map(|x| x.php.clone()).collect::<Vec<_>>().join(", ")
                    ),
                    Ty::Num,
                )
            }
            "reverse" if a.place.is_some() => {
                Out::atom(format!("\\Zero\\Js::reverse({})", place()?), Ty::Array(Box::new(el)))
            }
            "reverse" => Out::atom(format!("array_reverse({})", a.php), Ty::Array(Box::new(el))),
            "toReversed" => Out::atom(format!("array_reverse({})", a.php), Ty::Array(Box::new(el))),
            "splice" => {
                let argv = self.plain_args(args)?;
                let extra: Vec<String> = argv.iter().map(|x| x.php.clone()).collect();
                Out::atom(
                    format!("\\Zero\\Js::splice({}, {})", place()?, extra.join(", ")),
                    Ty::Array(Box::new(el)),
                )
            }
            "includes" | "indexOf" | "lastIndexOf" | "join" | "slice" | "at" | "concat" | "flat" | "fill" => {
                let argv = self.plain_args(args)?;
                let extra: Vec<String> = argv.iter().map(|x| x.php.clone()).collect();
                let all = std::iter::once(a.php.clone())
                    .chain(extra.iter().cloned())
                    .collect::<Vec<_>>()
                    .join(", ");
                match m {
                    "includes" => Out::atom(format!("\\Zero\\Js::includes({all})"), Ty::Bool),
                    "indexOf" | "lastIndexOf" => Out::atom(format!("\\Zero\\Js::{m}({all})"), Ty::Num),
                    "join" => {
                        if let Some(sep) = argv.first()
                            && !sep.ty.is_str()
                        {
                            return err(span, "join() needs a string separator");
                        }
                        Out::atom(format!("\\Zero\\Js::join({all})"), Ty::Str)
                    }
                    "slice" => Out::atom(format!("\\Zero\\Js::arrSlice({all})"), Ty::Array(Box::new(el))),
                    "at" => Out::atom(format!("\\Zero\\Js::arrAt({all})"), el.nullable()),
                    "concat" => {
                        let mut t = vec![el];
                        let mut parts = vec![a.php.clone()];
                        for x in &argv {
                            match x.ty.non_null() {
                                Ty::Array(e) => t.push(*e),
                                other => {
                                    t.push(other);
                                    parts.push(format!("[{}]", x.php));
                                    continue;
                                }
                            }
                            parts.push(x.php.clone());
                        }
                        Out::atom(
                            format!("array_merge({})", parts.join(", ")),
                            Ty::Array(Box::new(Ty::union(t))),
                        )
                    }
                    "flat" => {
                        let inner = match el {
                            Ty::Array(t) => *t,
                            t => t,
                        };
                        Out::atom(format!("\\Zero\\Js::flat({all})"), Ty::Array(Box::new(inner)))
                    }
                    _ => {
                        let p = place()?;
                        Out::atom(
                            format!("\\Zero\\Js::fill({p}, {})", extra.join(", ")),
                            Ty::Array(Box::new(el)),
                        )
                    }
                }
            }
            _ => return err(m_span, format!("arrays have no method `{m}` in Zero code")),
        })
    }

    // ---- database ---------------------------------------------------------------

    fn query_call(&mut self, table: &str, m: &str, args: &[ArrEl], span: Span, m_span: Span) -> Result<Out> {
        if !matches!(m, "findMany" | "findFirst") {
            return err_help(
                m_span,
                format!("`db.query.<collection>` has no method `{m}`"),
                "use findMany or findFirst",
            );
        }
        let (opts, row_ty) = match args.first() {
            None => ("[]".to_string(), types::row(self.schema, table)),
            Some(ArrEl::Item(o)) => self.query_opts(table, o, m == "findMany")?,
            Some(ArrEl::Spread(x)) => return err(x.span, "spread arguments aren't supported here"),
        };
        let _ = span;
        let (php, ty) = if m == "findMany" {
            (
                format!("\\Zero\\db()->findMany({}, {opts})", php_str(table)),
                Ty::Array(Box::new(row_ty)),
            )
        } else {
            (
                format!("\\Zero\\db()->findFirst({}, {opts})", php_str(table)),
                row_ty.nullable(),
            )
        };
        Ok(Out::atom(php, Ty::Promise(Box::new(ty))))
    }

    /// Compiles a query options literal, checking names against the schema and computing the result type.
    fn query_opts(&mut self, table: &str, e: &Expr, many: bool) -> Result<(String, Ty)> {
        let ExprKind::Object(props) = &e.kind else {
            return err_help(
                e.span,
                "query options must be an object literal",
                "write them inline: `findMany({ where: { ... } })`",
            );
        };
        let mut row = types::row(self.schema, table);
        let mut parts = Vec::new();
        let mut columns_pick: Option<Vec<String>> = None;
        let mut with_rels = Vec::new();
        for p in props {
            let Prop::KV(PropKey::Static(k), v) = p else {
                return err(e.span, "query options can't be spread or computed");
            };
            let php = match k.as_str() {
                "where" => self.filter(table, v, true)?,
                "orderBy" => self.order_by(table, v)?,
                "limit" | "offset" => {
                    if k == "limit" && !many {
                        return err(v.span, "findFirst always returns one row; drop `limit`");
                    }
                    let n = self.expr(v)?;
                    self.need_num(&n, v.span, &format!("`{k}`"))?;
                    format!("(int) {}", n.wrapped())
                }
                "columns" => {
                    let ExprKind::Object(cols) = &v.kind else {
                        return err(v.span, "`columns` must be an object like `{ id: true }`");
                    };
                    let mut picked = Vec::new();
                    let mut out = Vec::new();
                    for c in cols {
                        let Prop::KV(PropKey::Static(name), flag) = c else {
                            return err(v.span, "`columns` keys must be plain names");
                        };
                        self.check_column(table, name, flag.span)?;
                        let ExprKind::Bool(b) = flag.kind else {
                            return err(flag.span, "`columns` values must be true or false");
                        };
                        if b {
                            picked.push(name.clone());
                        }
                        out.push(format!("{} => {b}", php_str(name)));
                    }
                    columns_pick = Some(picked);
                    format!("[{}]", out.join(", "))
                }
                "with" => {
                    let (php, rels) = self.with_opts(table, v)?;
                    with_rels = rels;
                    php
                }
                other => {
                    let mut d = Diag::new(v.span, format!("query options have no `{other}`"));
                    if let Some(s) = suggest(other, ["where", "orderBy", "limit", "offset", "columns", "with"]) {
                        d = d.help(format!("did you mean `{s}`?"));
                    }
                    return Err(d);
                }
            };
            parts.push(format!("{} => {php}", php_str(k)));
        }
        if let (Some(picked), Ty::Obj(fields)) = (&columns_pick, &row)
            && !picked.is_empty()
        {
            row = Ty::Obj(
                fields
                    .iter()
                    .filter(|(k, _)| picked.contains(k))
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect(),
            );
        }
        for (rel, nested) in with_rels {
            row = match rel.strip_prefix('\u{0}') {
                // A media column populated in place.
                Some(col) => match row {
                    Ty::Obj(mut f) => {
                        f.insert(col.to_string(), (nested, false));
                        Ty::Obj(f)
                    }
                    other => other,
                },
                None => types::with_relations(self.schema, table, row, &rel, nested),
            };
        }
        Ok((format!("[{}]", parts.join(", ")), row))
    }

    fn with_opts(&mut self, table: &str, e: &Expr) -> Result<(String, Vec<(String, Ty)>)> {
        let ExprKind::Object(props) = &e.kind else {
            return err(e.span, "`with` must be an object like `{ location: true }`");
        };
        let mut parts = Vec::new();
        let mut rels = Vec::new();
        for p in props {
            let Prop::KV(PropKey::Static(rel), v) = p else {
                return err(e.span, "`with` keys must be relation names");
            };
            if let Some(col) = self.schema.collections[table].columns.get(rel)
                && matches!(col.ty, ColType::Media | ColType::MediaList)
            {
                if !matches!(v.kind, ExprKind::Bool(true)) {
                    return err(v.span, format!("`with.{rel}` loads the media row; use `true`"));
                }
                parts.push(format!("{} => true", php_str(rel)));
                let m = types::media_row();
                let t = if col.ty == ColType::MediaList {
                    Ty::Array(Box::new(m))
                } else {
                    m
                };
                rels.push((format!("\u{0}{rel}"), if col.not_null { t } else { t.nullable() }));
                continue;
            }
            let r = self.check_relation(table, rel, v.span)?.clone();
            match &v.kind {
                ExprKind::Bool(true) => {
                    parts.push(format!("{} => true", php_str(rel)));
                    rels.push((rel.clone(), types::row(self.schema, &r.collection)));
                }
                ExprKind::Object(_) => {
                    let (php, t) = self.query_opts(&r.collection, v, r.kind == RelKind::Many)?;
                    parts.push(format!("{} => {php}", php_str(rel)));
                    rels.push((rel.clone(), t));
                }
                _ => return err(v.span, "`with` values must be `true` or nested options"),
            }
        }
        Ok((format!("[{}]", parts.join(", ")), rels))
    }

    fn order_by(&mut self, table: &str, e: &Expr) -> Result<String> {
        let ExprKind::Object(props) = &e.kind else {
            return err(e.span, "`orderBy` must be an object like `{ name: \"asc\" }`");
        };
        let mut parts = Vec::new();
        for p in props {
            let Prop::KV(PropKey::Static(col), dir) = p else {
                return err(e.span, "`orderBy` keys must be column names");
            };
            let c = self.check_column(table, col, dir.span)?;
            if c.ty.is_json_kind() {
                return err(dir.span, "`orderBy` isn't supported on JSON columns");
            }
            if c.ty.is_list_kind() {
                return err(dir.span, "`orderBy` isn't supported on list columns");
            }
            let coll = &self.schema.collections[table];
            if coll.editor && coll.content.as_deref() == Some(col.as_str()) {
                return err(
                    dir.span,
                    format!("`orderBy` on `{col}` isn't supported on editor collections"),
                );
            }
            match &dir.kind {
                ExprKind::Str(d) if d == "asc" || d == "desc" => {
                    parts.push(format!("{} => {}", php_str(col), php_str(d)))
                }
                _ => return err(dir.span, "sort direction must be \"asc\" or \"desc\""),
            }
        }
        Ok(format!("[{}]", parts.join(", ")))
    }

    fn check_column(&self, table: &str, col: &str, span: Span) -> Result<&crate::schema::Column> {
        let c = &self.schema.collections[table];
        c.columns.get(col).ok_or_else(|| {
            let mut d = Diag::new(span, format!("\"{table}\" has no column `{col}`"));
            if let Some(s) = suggest(col, c.columns.keys().map(String::as_str)) {
                d = d.help(format!("did you mean `{s}`?"));
            }
            d
        })
    }

    fn check_relation(&self, table: &str, rel: &str, span: Span) -> Result<&crate::schema::Relation> {
        let c = &self.schema.collections[table];
        c.relations.get(rel).ok_or_else(|| {
            let mut d = Diag::new(span, format!("\"{table}\" has no relation `{rel}`"));
            if let Some(s) = suggest(rel, c.relations.keys().map(String::as_str)) {
                d = d.help(format!("did you mean `{s}`?"));
            } else {
                d = d.help("define it in defineRelations()");
            }
            d
        })
    }

    /// A `where` filter. Literal objects are checked against the schema; other expressions must be typed objects.
    fn filter(&mut self, table: &str, e: &Expr, allow_relations: bool) -> Result<String> {
        let ExprKind::Object(props) = &e.kind else {
            let v = self.expr(e)?;
            if !matches!(v.ty.non_null(), Ty::Obj(_) | Ty::Map(_)) {
                return err(e.span, format!("a filter must be an object, not {}", v.ty.describe()));
            }
            return Ok(v.php);
        };
        let mut parts = Vec::new();
        for p in props {
            let Prop::KV(PropKey::Static(k), v) = p else {
                return err(e.span, "filter keys must be plain names");
            };
            let php = match k.as_str() {
                "OR" | "AND" => {
                    let ExprKind::Array(items) = &v.kind else {
                        return err(v.span, format!("`{k}` takes an array of filters"));
                    };
                    let mut subs = Vec::new();
                    for it in items {
                        let ArrEl::Item(x) = it else {
                            return err(v.span, "spread isn't supported here");
                        };
                        subs.push(self.filter(table, x, allow_relations)?);
                    }
                    format!("[{}]", subs.join(", "))
                }
                "NOT" => self.filter(table, v, allow_relations)?,
                name => {
                    let c = &self.schema.collections[table];
                    if let Some(col) = c.columns.get(name) {
                        let col = col.clone();
                        let editor = c.editor;
                        self.field_filter(&col, v, editor)?
                    } else if c.relations.contains_key(name) {
                        if !allow_relations {
                            return err(v.span, "relation filters only work in findMany/findFirst");
                        }
                        let target = c.relations[name].collection.clone();
                        match &v.kind {
                            ExprKind::Bool(true) => "true".to_string(),
                            _ => self.filter(&target, v, true)?,
                        }
                    } else {
                        let mut d = Diag::new(v.span, format!("\"{table}\" has no column or relation `{name}`"));
                        let names: Vec<&str> = c.columns.keys().chain(c.relations.keys()).map(String::as_str).collect();
                        if let Some(s) = suggest(name, names) {
                            d = d.help(format!("did you mean `{s}`?"));
                        }
                        return Err(d);
                    }
                }
            };
            parts.push(format!("{} => {php}", php_str(k)));
        }
        Ok(format!("[{}]", parts.join(", ")))
    }

    /// `editor`: the collection is post-backed on WordPress (§3.5.1 limits what can be filtered).
    fn field_filter(&mut self, col: &crate::schema::Column, e: &Expr, editor: bool) -> Result<String> {
        let spread_meta = |op: &str, span: Span| -> Result<()> {
            if editor && col.ty.is_structured() {
                return err_help(
                    span,
                    format!(
                        "`{op}` on `{}` isn't supported on editor collections; filter on a scalar column",
                        col.name
                    ),
                    "on WordPress this value is spread over many postmeta rows; use isNull/isNotNull, or `editor: false`",
                );
            }
            Ok(())
        };
        let col_ty = col_value_ty(col);
        let is_json = col.ty.is_json_kind();
        let is_list = col.ty.is_list_kind();
        // `{ tags: ["a"] }` / `{ seo: {...} }`: a whole value, compared with `eq`.
        let whole_value = match &e.kind {
            ExprKind::Object(props) => {
                is_json
                    && !props
                        .iter()
                        .all(|p| matches!(p, Prop::KV(PropKey::Static(k), _) if FILTER_OPS.contains(&k.as_str())))
            }
            ExprKind::Array(_) => is_list || is_json,
            _ => true,
        };
        if whole_value {
            let v = self.expr(e)?;
            let v = self.finish_value(v, e.span)?;
            if !assignable(&v.ty, &col_ty.clone().nullable()) {
                return err(
                    e.span,
                    format!(
                        "`{}` is {}, but this is {}",
                        col.name,
                        col_ty.describe(),
                        v.ty.describe()
                    ),
                );
            }
            if v.ty != Ty::Null {
                spread_meta("eq", e.span)?;
            }
            if is_list && !matches!(&e.kind, ExprKind::Array(a) if a.is_empty()) && v.ty != Ty::Null {
                return err_help(
                    e.span,
                    "`eq` isn't supported on list columns; use `has`",
                    format!("write `{{ {}: {{ has: ... }} }}`", col.name),
                );
            }
            return Ok(self.filter_value(col, &v));
        }
        let ExprKind::Object(props) = &e.kind else {
            unreachable!("non-objects are whole values")
        };
        let mut parts = Vec::new();
        for p in props {
            let Prop::KV(PropKey::Static(op), v) = p else {
                return err(e.span, "filter operators must be plain names");
            };
            if (is_json || is_list) && !matches!(op.as_str(), "isNull" | "isNotNull" | "NOT" | "OR" | "AND") {
                let allowed = if is_json {
                    matches!(op.as_str(), "eq" | "ne")
                } else {
                    op == "has" || (op == "eq" && matches!(&v.kind, ExprKind::Array(a) if a.is_empty()))
                };
                if !allowed && FILTER_OPS.contains(&op.as_str()) {
                    return Err(if is_json {
                        Diag::new(v.span, format!("`{op}` isn't supported on JSON columns"))
                    } else {
                        Diag::new(v.span, format!("`{op}` isn't supported on list columns; use `has`"))
                    });
                }
            }
            if matches!(op.as_str(), "eq" | "ne") && !matches!(v.kind, ExprKind::Null | ExprKind::Undefined) {
                spread_meta(op, v.span)?;
            }
            let php = match op.as_str() {
                "eq" | "ne" | "gt" | "gte" | "lt" | "lte" => {
                    let x = self.expr(v)?;
                    let x = self.finish_value(x, v.span)?;
                    let want = if matches!(col.ty, ColType::Timestamp | ColType::Date) {
                        Ty::union([Ty::Str, Ty::Num, Ty::Date])
                    } else {
                        col_ty.clone()
                    };
                    let want = if matches!(op.as_str(), "eq" | "ne") {
                        want.nullable()
                    } else {
                        want
                    };
                    if !assignable(&x.ty, &want) {
                        return err(
                            v.span,
                            format!(
                                "`{}` is {}, but this is {}",
                                col.name,
                                col_ty.describe(),
                                x.ty.describe()
                            ),
                        );
                    }
                    self.filter_value(col, &x)
                }
                "has" => {
                    let Ty::Array(el) = &col_ty else {
                        return err(v.span, "`has` is only supported on list columns");
                    };
                    let x = self.expr(v)?;
                    let x = self.finish_value(x, v.span)?;
                    if !assignable(&x.ty, el) {
                        return err(
                            v.span,
                            format!(
                                "`{}` holds {}, but this is {}",
                                col.name,
                                el.describe(),
                                x.ty.describe()
                            ),
                        );
                    }
                    x.php
                }
                "in" | "notIn" => {
                    let x = self.expr(v)?;
                    if !matches!(x.ty.non_null(), Ty::Array(_) | Ty::Tuple(_) | Ty::ArrayLiteral(_)) {
                        return err(v.span, format!("`{op}` takes an array"));
                    }
                    x.php
                }
                "like" | "ilike" | "notLike" | "notIlike" => {
                    let x = self.expr(v)?;
                    if !x.ty.is_str() {
                        return err(v.span, format!("`{op}` takes a string pattern"));
                    }
                    x.php
                }
                "isNull" | "isNotNull" => match v.kind {
                    ExprKind::Bool(true) => "true".into(),
                    _ => return err(v.span, format!("`{op}` takes `true`")),
                },
                "NOT" => self.field_filter(col, v, editor)?,
                "OR" | "AND" => {
                    let ExprKind::Array(items) = &v.kind else {
                        return err(v.span, format!("`{op}` takes an array"));
                    };
                    let mut subs = Vec::new();
                    for it in items {
                        let ArrEl::Item(x) = it else {
                            return err(v.span, "spread isn't supported here");
                        };
                        subs.push(self.field_filter(col, x, editor)?);
                    }
                    format!("[{}]", subs.join(", "))
                }
                other => {
                    let mut d = Diag::new(v.span, format!("unknown filter operator `{other}`"));
                    if let Some(s) = suggest(other, FILTER_OPS.iter().copied()) {
                        d = d.help(format!("did you mean `{s}`?"));
                    }
                    return Err(d);
                }
            };
            parts.push(format!("{} => {php}", php_str(op)));
        }
        Ok(format!("[{}]", parts.join(", ")))
    }

    /// Filter values for timestamp/date columns accept Dates (epoch ms): convert to the stored form.
    fn filter_value(&self, col: &crate::schema::Column, v: &Out) -> String {
        match (col.ty, &v.ty) {
            (ColType::Timestamp, Ty::Date | Ty::Num) => format!("\\Zero\\Js::iso({})", v.php),
            (ColType::Date, Ty::Date | Ty::Num) => format!("substr(\\Zero\\Js::iso({}), 0, 10)", v.php),
            _ => v.php.clone(),
        }
    }

    fn db_call(&mut self, m: &str, args: &[ArrEl], span: Span, m_span: Span) -> Result<Out> {
        let kind = match m {
            "insert" => BuilderKind::Insert,
            "update" => BuilderKind::Update,
            "delete" => BuilderKind::Delete,
            "query" => {
                return err(
                    m_span,
                    "`db.query` isn't a function: use `db.query.<collection>.findMany(...)`",
                );
            }
            other => {
                return err_help(
                    m_span,
                    format!("`db` has no method `{other}`"),
                    "use db.query, db.insert, db.update, or db.delete",
                );
            }
        };
        let t = self.arg(args, 0, span, "a collection")?;
        let v = self.expr(t)?;
        let Ty::Collection(table) = v.ty else {
            return err(t.span, format!("db.{m}() needs a collection, not {}", v.ty.describe()));
        };
        Ok(Out::atom(
            "",
            Ty::Builder(Box::new(Builder {
                kind,
                table,
                values: None,
                set: None,
                filter: None,
                returning: false,
            })),
        ))
    }

    fn builder_call(&mut self, mut b: Builder, m: &str, args: &[ArrEl], span: Span, m_span: Span) -> Result<Out> {
        match (b.kind.clone(), m) {
            (BuilderKind::Insert, "values") if b.values.is_none() => {
                let x = self.arg(args, 0, span, "values")?;
                b.values = Some(self.write_values(&b.table, x, true)?);
            }
            (BuilderKind::Update, "set") if b.set.is_none() => {
                let x = self.arg(args, 0, span, "the changes")?;
                b.set = Some(self.write_values(&b.table, x, false)?);
            }
            (BuilderKind::Update | BuilderKind::Delete, "where") if b.filter.is_none() => {
                let x = self.arg(args, 0, span, "a filter")?;
                b.filter = Some(self.filter(&b.table, x, false)?);
            }
            (_, "returning") if !b.returning => b.returning = true,
            (kind, other) => {
                let valid = match kind {
                    BuilderKind::Insert => "values(...), returning()",
                    BuilderKind::Update => "set(...), where(...), returning()",
                    BuilderKind::Delete => "where(...), returning()",
                };
                return err_help(
                    m_span,
                    format!("`{other}` isn't valid here"),
                    format!("this call takes {valid}"),
                );
            }
        }
        if b.kind == BuilderKind::Insert && b.values.is_none() && m == "returning" {
            return err(span, "call values(...) before returning()");
        }
        Ok(Out::atom("", Ty::Builder(Box::new(b))))
    }

    /// Insert values / update patch: literal objects are checked field by field.
    fn write_values(&mut self, table: &str, e: &Expr, insert: bool) -> Result<String> {
        if let ExprKind::Array(items) = &e.kind
            && insert
        {
            let mut rows = Vec::new();
            for it in items {
                let ArrEl::Item(x) = it else {
                    return err(e.span, "spread isn't supported here");
                };
                rows.push(self.write_values(table, x, true)?);
            }
            return Ok(format!("[{}]", rows.join(", ")));
        }
        let v = self.expr(e)?;
        let v = self.finish_value(v, e.span)?;
        let want = if insert {
            types::insert(self.schema, table)
        } else {
            types::partial(types::insert(self.schema, table))
        };
        let ok = match (&v.ty, insert) {
            (Ty::Array(el), true) => assignable(el, &want),
            (t, _) => assignable(t, &want),
        };
        if !ok {
            // Point at the exact field when we can.
            if let (Ty::Obj(have), Ty::Obj(need)) = (&v.ty, &want) {
                for (k, (t, _)) in have {
                    match need.get(k) {
                        None => return Err(self.no_field(&want, k, e.span)),
                        Some((nt, _)) if !assignable(t, nt) => {
                            return err(e.span, format!("`{k}` must be {}, not {}", nt.describe(), t.describe()));
                        }
                        _ => {}
                    }
                }
                for (k, (_, optional)) in need {
                    if !optional && !have.contains_key(k) {
                        return err(e.span, format!("missing required field `{k}`"));
                    }
                }
            }
            return err(
                e.span,
                format!("{} doesn't fit \"{table}\" ({})", v.ty.describe(), want.describe()),
            );
        }
        Ok(v.php)
    }
}

const FILTER_OPS: &[&str] = &[
    "eq",
    "ne",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "notIn",
    "like",
    "ilike",
    "notLike",
    "notIlike",
    "isNull",
    "isNotNull",
    "has",
    "NOT",
    "OR",
    "AND",
];

fn col_value_ty(c: &crate::schema::Column) -> Ty {
    match c.ty {
        ColType::Json => Ty::Unknown,
        _ => types::col_base(c, &|_| Ty::Unknown, false),
    }
}

fn obj_values_ty(t: Option<&Ty>) -> Ty {
    match t.map(Ty::non_null) {
        Some(Ty::Obj(f)) => Ty::union(f.values().map(|(t, _)| t.clone())),
        Some(Ty::Map(t)) => *t,
        _ => Ty::Unknown,
    }
}

fn int_index(i: &Out) -> String {
    if i.atomic && i.php.chars().all(|c| c.is_ascii_digit()) {
        i.php.clone()
    } else {
        format!("(int) {}", i.wrapped())
    }
}

fn paren(s: &str) -> String {
    format!("({s})")
}

/// `.` binds tighter than `+`/`-`... in PHP 8 they're equal-precedence-ish; parenthesize non-trivial parts.
fn pad(n: usize) -> String {
    "    ".repeat(n)
}

fn php_hint(t: &Ty) -> &'static str {
    match t {
        Ty::Obj(_) | Ty::Map(_) | Ty::Array(_) | Ty::Tuple(_) | Ty::ArrayLiteral(_) => "array ",
        t if t.is_str() => "string ",
        t if t.is_bool() => "bool ",
        Ty::Num => "int|float ",
        _ => "",
    }
}

fn ty_of_json(v: &serde_json::Value) -> Ty {
    use serde_json::Value as J;
    match v {
        J::Null => Ty::Null,
        J::Bool(value) => Ty::FreshBoolLit(*value),
        J::Number(_) => Ty::Num,
        J::String(s) => Ty::FreshStrLit(s.clone()),
        J::Array(items) => Ty::Array(Box::new(Ty::union(items.iter().map(ty_of_json)))),
        J::Object(map) => Ty::Obj(map.iter().map(|(k, v)| (k.clone(), (ty_of_json(v), false))).collect()),
    }
}

fn inferred_binding_type(t: &Ty, mutable: bool) -> Ty {
    match t {
        Ty::FreshStrLit(_) | Ty::FreshBoolLit(_) if !mutable => t.clone(),
        Ty::Union(ts) => Ty::union(ts.iter().map(|t| inferred_binding_type(t, mutable))),
        _ => widen_literal_array(t),
    }
}

fn widen_literal_array(t: &Ty) -> Ty {
    match t {
        Ty::FreshStrLit(_) => Ty::Str,
        Ty::FreshBoolLit(_) => Ty::Bool,
        Ty::ArrayLiteral(ts) => Ty::Array(Box::new(Ty::union(ts.iter().map(widen_literal_array)))),
        Ty::Tuple(ts) => Ty::Tuple(ts.iter().map(widen_literal_array).collect()),
        Ty::Array(t) => Ty::Array(Box::new(widen_literal_array(t))),
        Ty::Union(ts) => Ty::union(ts.iter().map(widen_literal_array)),
        Ty::Obj(f) => Ty::Obj(
            f.iter()
                .map(|(k, (t, o))| (k.clone(), (widen_literal_array(t), *o)))
                .collect(),
        ),
        Ty::Map(t) => Ty::Map(Box::new(widen_literal_array(t))),
        other => other.clone(),
    }
}

/// Is a value of type `a` usable where `b` is expected?
pub fn assignable(a: &Ty, b: &Ty) -> bool {
    if a == b || *b == Ty::Unknown || *a == Ty::Never {
        return true;
    }
    match (a, b) {
        (Ty::StrLit(_) | Ty::FreshStrLit(_), Ty::Str) => true,
        (Ty::BoolLit(_) | Ty::FreshBoolLit(_), Ty::Bool) => true,
        (Ty::BoolLit(x), Ty::FreshBoolLit(y)) | (Ty::FreshBoolLit(x), Ty::BoolLit(y)) => x == y,
        (Ty::StrLit(x), Ty::FreshStrLit(y)) | (Ty::FreshStrLit(x), Ty::StrLit(y)) => x == y,
        (Ty::Union(xs), _) => xs.iter().all(|x| assignable(x, b)),
        (_, Ty::Union(ys)) => ys.iter().any(|y| assignable(a, y)),
        (Ty::Date, Ty::Num) => true,
        (Ty::Array(x), Ty::Array(y)) => **x == Ty::Never || assignable(x, y),
        (Ty::Tuple(xs) | Ty::ArrayLiteral(xs), Ty::Array(y)) => xs.iter().all(|x| assignable(x, y)),
        (Ty::Tuple(xs) | Ty::ArrayLiteral(xs), Ty::Tuple(ys) | Ty::ArrayLiteral(ys)) => {
            xs.len() == ys.len() && xs.iter().zip(ys).all(|(x, y)| assignable(x, y))
        }
        (Ty::Obj(have), Ty::Obj(need)) => {
            need.iter().all(|(k, (t, optional))| match have.get(k) {
                Some((ht, _)) => assignable(ht, t),
                None => *optional,
            }) && have.keys().all(|k| need.contains_key(k))
        }
        (Ty::Obj(have), Ty::Map(v)) => have.values().all(|(t, _)| assignable(t, v)),
        (Ty::Map(x), Ty::Map(y)) => assignable(x, y),
        (Ty::Fn(pa, ra), Ty::Fn(pb, rb)) => {
            pa.len() <= pb.len() && pa.iter().zip(pb).all(|(x, y)| assignable(y, x)) && assignable(ra, rb)
        }
        _ => false,
    }
}

fn stmt_span(s: &Stmt) -> Span {
    match s {
        Stmt::Decl { span, .. } | Stmt::Return(_, span) | Stmt::Break(span) | Stmt::Continue(span) => *span,
        Stmt::Expr(e) | Stmt::Throw(e) | Stmt::If(e, ..) | Stmt::While(e, _) => e.span,
        Stmt::For { span, .. } | Stmt::ForOf { span, .. } | Stmt::Switch { span, .. } => *span,
        Stmt::Func(f) => f.span,
        _ => Span::NONE,
    }
}

fn ends_with_exit(stmts: &[Stmt]) -> bool {
    matches!(
        stmts.last(),
        Some(Stmt::Return(..) | Stmt::Throw(_) | Stmt::Continue(_) | Stmt::Break(_))
    )
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Completion {
    Normal,
    Return,
    Throw,
    Break,
    Continue,
}

fn followed_by(mut first: HashSet<Completion>, second: HashSet<Completion>) -> HashSet<Completion> {
    if first.remove(&Completion::Normal) {
        first.extend(second);
    }
    first
}

fn switch_is_exhaustive(ty: &Ty, case_types: &[Ty]) -> bool {
    match ty {
        Ty::Bool => {
            case_types.iter().any(|ty| ty.bool_literal() == Some(true))
                && case_types.iter().any(|ty| ty.bool_literal() == Some(false))
        }
        Ty::BoolLit(value) | Ty::FreshBoolLit(value) => case_types.iter().any(|ty| ty.bool_literal() == Some(*value)),
        Ty::StrLit(value) | Ty::FreshStrLit(value) => case_types
            .iter()
            .any(|ty| matches!(ty, Ty::StrLit(case) | Ty::FreshStrLit(case) if case == value)),
        Ty::Null => case_types.contains(&Ty::Null),
        Ty::Union(items) => items.iter().all(|ty| switch_is_exhaustive(ty, case_types)),
        Ty::Never => true,
        _ => false,
    }
}

fn block_completions(
    stmts: &[Stmt],
    diverging: &HashSet<Span>,
    exhaustive_switches: &HashSet<Span>,
) -> HashSet<Completion> {
    stmts.iter().fold(HashSet::from([Completion::Normal]), |flow, stmt| {
        followed_by(flow, stmt_completions(stmt, diverging, exhaustive_switches))
    })
}

fn stmt_completions(
    stmt: &Stmt,
    diverging: &HashSet<Span>,
    exhaustive_switches: &HashSet<Span>,
) -> HashSet<Completion> {
    use Completion::*;
    match stmt {
        Stmt::Expr(expr)
        | Stmt::Decl { init: Some(expr), .. }
        | Stmt::If(expr, ..)
        | Stmt::While(expr, _)
        | Stmt::Switch { disc: expr, .. }
            if diverging.contains(&expr.span) =>
        {
            HashSet::from([Throw])
        }
        Stmt::Return(..) => HashSet::from([Return]),
        Stmt::Throw(_) => HashSet::from([Throw]),
        Stmt::Break(_) => HashSet::from([Break]),
        Stmt::Continue(_) => HashSet::from([Continue]),
        Stmt::Block(body) => block_completions(body, diverging, exhaustive_switches),
        Stmt::If(test, yes, no) => {
            let yes = block_completions(yes, diverging, exhaustive_switches);
            let no = no
                .as_deref()
                .map(|body| block_completions(body, diverging, exhaustive_switches))
                .unwrap_or_else(|| HashSet::from([Normal]));
            match test.kind {
                ExprKind::Bool(true) => yes,
                ExprKind::Bool(false) => no,
                _ => yes.union(&no).copied().collect(),
            }
        }
        Stmt::Try {
            block,
            handler,
            finalizer,
            ..
        } => {
            let mut flow = block_completions(block, diverging, exhaustive_switches);
            if let Some(handler) = handler {
                flow.remove(&Throw);
                flow.extend(block_completions(handler, diverging, exhaustive_switches));
            }
            if let Some(finalizer) = finalizer {
                let mut final_flow = block_completions(finalizer, diverging, exhaustive_switches);
                if final_flow.remove(&Normal) {
                    final_flow.extend(flow);
                }
                flow = final_flow;
            }
            flow
        }
        Stmt::Switch { cases, span, .. } => {
            let mut suffix = HashSet::from([Normal]);
            let mut flow = HashSet::new();
            for (_, body) in cases.iter().rev() {
                suffix = followed_by(block_completions(body, diverging, exhaustive_switches), suffix);
                flow.extend(&suffix);
            }
            let breaks = flow.remove(&Break);
            if !(cases.iter().any(|(test, _)| test.is_none()) || exhaustive_switches.contains(span)) || breaks {
                flow.insert(Normal);
            }
            flow
        }
        Stmt::While(test, body)
        | Stmt::For {
            test: Some(test), body, ..
        } => {
            let mut flow = block_completions(body, diverging, exhaustive_switches);
            let breaks = flow.remove(&Break);
            flow.remove(&Continue);
            flow.remove(&Normal);
            if !matches!(test.kind, ExprKind::Bool(true)) || breaks {
                flow.insert(Normal);
            }
            flow
        }
        Stmt::For { test: None, body, .. } => {
            let mut flow = block_completions(body, diverging, exhaustive_switches);
            if flow.remove(&Break) {
                flow.insert(Normal);
            } else {
                flow.remove(&Normal);
            }
            flow.remove(&Continue);
            flow
        }
        Stmt::ForOf { body, .. } => {
            let mut flow = block_completions(body, diverging, exhaustive_switches);
            flow.remove(&Break);
            flow.remove(&Continue);
            flow.insert(Normal);
            flow
        }
        _ => HashSet::from([Normal]),
    }
}

/// Parameters a function assigns into (`data.x = ...`, `items.push(...)`), passed by reference in PHP.
fn mutated_params(f: &Func) -> HashSet<String> {
    let mut names: HashSet<String> = HashSet::new();
    let params: Vec<String> = f
        .params
        .iter()
        .filter_map(|p| {
            if let Pat::Id(n, _) = &p.pat {
                Some(n.clone())
            } else {
                None
            }
        })
        .collect();
    fn root(e: &Expr) -> Option<&str> {
        match &e.kind {
            ExprKind::Ident(n) => Some(n),
            ExprKind::Member { obj, .. } | ExprKind::Index { obj, .. } | ExprKind::NonNull(obj) => root(obj),
            _ => None,
        }
    }
    fn walk_e(e: &Expr, params: &[String], out: &mut HashSet<String>) {
        match &e.kind {
            ExprKind::Assign { target, value, .. } => {
                if !matches!(target.kind, ExprKind::Ident(_))
                    && let Some(r) = root(target)
                    && params.iter().any(|p| p == r)
                {
                    out.insert(r.to_string());
                }
                walk_e(value, params, out);
            }
            ExprKind::Update { target, .. } => {
                if !matches!(target.kind, ExprKind::Ident(_))
                    && let Some(r) = root(target)
                    && params.iter().any(|p| p == r)
                {
                    out.insert(r.to_string());
                }
            }
            ExprKind::Call { callee, args, .. } => {
                if let ExprKind::Member { obj, prop, .. } = &callee.kind
                    && matches!(
                        prop.as_str(),
                        "push" | "pop" | "shift" | "unshift" | "splice" | "sort" | "reverse" | "fill"
                    )
                    && let Some(r) = root(obj)
                    && params.iter().any(|p| p == r)
                {
                    out.insert(r.to_string());
                }
                walk_e(callee, params, out);
                for a in args {
                    match a {
                        ArrEl::Item(x) | ArrEl::Spread(x) => walk_e(x, params, out),
                    }
                }
            }
            ExprKind::Binary(_, a, b) | ExprKind::Logical(_, a, b) => {
                walk_e(a, params, out);
                walk_e(b, params, out);
            }
            ExprKind::Cond(a, b, c) => {
                walk_e(a, params, out);
                walk_e(b, params, out);
                walk_e(c, params, out);
            }
            ExprKind::Unary(_, x)
            | ExprKind::Await(x)
            | ExprKind::Chain(x)
            | ExprKind::As(x, _)
            | ExprKind::NonNull(x)
            | ExprKind::IsNullish(x, _) => walk_e(x, params, out),
            _ => {}
        }
    }
    fn walk_s(stmts: &[Stmt], params: &[String], out: &mut HashSet<String>) {
        for s in stmts {
            match s {
                Stmt::Expr(e) | Stmt::Throw(e) => walk_e(e, params, out),
                Stmt::Return(Some(e), _) => walk_e(e, params, out),
                Stmt::Decl { init: Some(e), .. } => walk_e(e, params, out),
                Stmt::If(t, a, b) => {
                    walk_e(t, params, out);
                    walk_s(a, params, out);
                    if let Some(b) = b {
                        walk_s(b, params, out);
                    }
                }
                Stmt::Block(b) | Stmt::While(_, b) => walk_s(b, params, out),
                Stmt::For { body, .. } | Stmt::ForOf { body, .. } => walk_s(body, params, out),
                Stmt::Try {
                    block,
                    handler,
                    finalizer,
                    ..
                } => {
                    walk_s(block, params, out);
                    if let Some(h) = handler {
                        walk_s(h, params, out);
                    }
                    if let Some(f) = finalizer {
                        walk_s(f, params, out);
                    }
                }
                Stmt::Switch { cases, .. } => {
                    for (_, b) in cases {
                        walk_s(b, params, out);
                    }
                }
                _ => {}
            }
        }
    }
    match &f.body {
        FnBody::Expr(e) => walk_e(e, &params, &mut names),
        FnBody::Block(b) => walk_s(b, &params, &mut names),
    }
    names
}

fn collect_aliases(body: &[Stmt], module: usize, out: &mut HashMap<(usize, String), (Vec<String>, TyAnn)>) {
    for s in body {
        match s {
            Stmt::TypeAlias { name, params, ty } => {
                out.insert((module, name.clone()), (params.clone(), ty.clone()));
            }
            Stmt::Exported(inner) => collect_aliases(std::slice::from_ref(inner.as_ref()), module, out),
            _ => {}
        }
    }
}

/// JS shares arrays and objects by reference; compiled PHP copies them when
/// they're stored. Code that stores a local container inside another value
/// and then mutates it would silently diverge, so it's a build error.
fn check_aliasing(f: &Func) -> Result<()> {
    struct Walk {
        /// Local name → span where it was stored into another value.
        stored: HashMap<String, Span>,
    }
    fn root(e: &Expr) -> Option<&str> {
        match &e.kind {
            ExprKind::Ident(n) => Some(n),
            ExprKind::Member { obj, .. } | ExprKind::Index { obj, .. } | ExprKind::NonNull(obj) => root(obj),
            _ => None,
        }
    }
    const MUTATORS: &[&str] = &["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill"];
    impl Walk {
        fn mutated(&self, name: &str, span: Span) -> Result<()> {
            if let Some(at) = self.stored.get(name) {
                let _ = at;
                return err_help(
                    span,
                    format!("`{name}` was stored in another value earlier, so changing it here wouldn't show up there"),
                    "build the value completely before storing it, or change it through the place you stored it",
                );
            }
            Ok(())
        }
        /// Bare identifiers placed inside array/object literals or passed into db calls get copied.
        fn note_stores(&mut self, e: &Expr) {
            match &e.kind {
                ExprKind::Array(items) => {
                    for it in items {
                        if let ArrEl::Item(x) = it {
                            self.note_store(x);
                        }
                    }
                }
                ExprKind::Object(props) => {
                    for p in props {
                        if let Prop::KV(_, x) = p {
                            self.note_store(x);
                        }
                    }
                }
                _ => {}
            }
        }
        fn note_store(&mut self, x: &Expr) {
            if let ExprKind::Ident(n) = &x.kind {
                self.stored.entry(n.clone()).or_insert(x.span);
            }
        }
        fn expr(&mut self, e: &Expr) -> Result<()> {
            match &e.kind {
                ExprKind::Assign { target, value, .. } => {
                    self.expr(value)?;
                    if !matches!(target.kind, ExprKind::Ident(_))
                        && let Some(r) = root(target)
                    {
                        self.mutated(r, target.span)?;
                    }
                    if !matches!(target.kind, ExprKind::Ident(_)) {
                        self.note_store(value);
                    }
                    self.note_stores(value);
                }
                ExprKind::Update { target, .. } => {
                    if !matches!(target.kind, ExprKind::Ident(_))
                        && let Some(r) = root(target)
                    {
                        self.mutated(r, target.span)?;
                    }
                }
                ExprKind::Call { callee, args, .. } => {
                    if let ExprKind::Member { obj, prop, .. } = &callee.kind
                        && MUTATORS.contains(&prop.as_str())
                        && let Some(r) = root(obj)
                    {
                        self.mutated(r, e.span)?;
                    }
                    self.expr(callee)?;
                    for a in args {
                        let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
                        self.expr(x)?;
                        if let ArrEl::Item(x) = a
                            && matches!(&callee.kind, ExprKind::Member { prop, .. } if prop == "push" || prop == "unshift")
                        {
                            self.note_store(x);
                        }
                        self.note_stores(x);
                    }
                }
                ExprKind::Array(_) | ExprKind::Object(_) => {
                    self.note_stores(e);
                    match &e.kind {
                        ExprKind::Array(items) => {
                            for it in items {
                                let (ArrEl::Item(x) | ArrEl::Spread(x)) = it;
                                self.expr(x)?;
                            }
                        }
                        ExprKind::Object(props) => {
                            for p in props {
                                let (Prop::KV(_, x) | Prop::Spread(x)) = p;
                                self.expr(x)?;
                            }
                        }
                        _ => {}
                    }
                }
                ExprKind::Binary(_, a, b) | ExprKind::Logical(_, a, b) => {
                    self.expr(a)?;
                    self.expr(b)?;
                }
                ExprKind::Cond(a, b, c) => {
                    self.expr(a)?;
                    self.expr(b)?;
                    self.expr(c)?;
                }
                ExprKind::Unary(_, x)
                | ExprKind::Await(x)
                | ExprKind::Chain(x)
                | ExprKind::As(x, _)
                | ExprKind::NonNull(x)
                | ExprKind::IsNullish(x, _)
                | ExprKind::Member { obj: x, .. } => self.expr(x)?,
                ExprKind::Index { obj, index, .. } => {
                    self.expr(obj)?;
                    self.expr(index)?;
                }
                ExprKind::Template(_, xs) => {
                    for x in xs {
                        self.expr(x)?;
                    }
                }
                // Nested functions are checked on their own.
                _ => {}
            }
            Ok(())
        }
        fn stmts(&mut self, stmts: &[Stmt]) -> Result<()> {
            for s in stmts {
                match s {
                    Stmt::Decl { init: Some(e), .. } => {
                        self.expr(e)?;
                        self.note_stores(e);
                    }
                    Stmt::Expr(e) | Stmt::Throw(e) | Stmt::Return(Some(e), _) => self.expr(e)?,
                    Stmt::If(t, a, b) => {
                        self.expr(t)?;
                        self.stmts(a)?;
                        if let Some(b) = b {
                            self.stmts(b)?;
                        }
                    }
                    Stmt::Block(b) => self.stmts(b)?,
                    Stmt::While(t, b) => {
                        self.expr(t)?;
                        self.stmts(b)?;
                    }
                    Stmt::For {
                        init,
                        test,
                        update,
                        body,
                        ..
                    } => {
                        if let Some(i) = init {
                            self.stmts(std::slice::from_ref(i))?;
                        }
                        if let Some(t) = test {
                            self.expr(t)?;
                        }
                        if let Some(u) = update {
                            self.expr(u)?;
                        }
                        self.stmts(body)?;
                    }
                    Stmt::ForOf { iter, body, .. } => {
                        self.expr(iter)?;
                        self.stmts(body)?;
                    }
                    Stmt::Try {
                        block,
                        handler,
                        finalizer,
                        ..
                    } => {
                        self.stmts(block)?;
                        if let Some(h) = handler {
                            self.stmts(h)?;
                        }
                        if let Some(f) = finalizer {
                            self.stmts(f)?;
                        }
                    }
                    Stmt::Switch { disc, cases, .. } => {
                        self.expr(disc)?;
                        for (t, b) in cases {
                            if let Some(t) = t {
                                self.expr(t)?;
                            }
                            self.stmts(b)?;
                        }
                    }
                    _ => {}
                }
            }
            Ok(())
        }
    }
    let mut w = Walk { stored: HashMap::new() };
    match &f.body {
        FnBody::Expr(e) => w.expr(e),
        FnBody::Block(b) => w.stmts(b),
    }
}
