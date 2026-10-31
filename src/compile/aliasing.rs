//! Reject-first aliasing check. JavaScript shares objects and arrays by reference; compiled PHP
//! copies arrays on assignment, on return and when passing by value. A write through one name to a
//! container that another live name also holds would show up in JS and silently not in PHP, so it
//! is a build error with a located fix.
//!
//! The analysis is per function and conservative: a local is *shared* when its value may be the
//! same container as another binding or element (an alias of a local, a member or element read, a
//! destructured element, a value returned by a call that may return its argument, a callback's
//! element parameter, a `for...of` element of an expression other than a plain local). A *fresh*
//! value (a literal, a spread copy's top level, `map`/`filter`/`slice`/`concat`/... results, a db
//! call, a string or number) is not shared. Writing into a shared local (`x.k = v`, `x[i] = v`,
//! `x.k++`, `x.push(..)`, ...) is rejected. Parameters are by-reference when the effects analysis
//! says so (compile.rs keeps that path faithful), so a parameter itself is not shared; a local
//! taken from one is.

use super::*;

/// Calls whose result is a new container (never the receiver or an element of it).
const FRESH_METHODS: &[&str] = &[
    "map",
    "filter",
    "slice",
    "concat",
    "flat",
    "flatMap",
    "toSorted",
    "toReversed",
    "split",
    "join",
    "keys",
    "values",
    "entries",
    "trim",
    "toLowerCase",
    "toUpperCase",
    "padStart",
    "padEnd",
    "repeat",
    "replace",
    "replaceAll",
    "toFixed",
    "toString",
    "indexOf",
    "lastIndexOf",
    "includes",
    "some",
    "every",
    "findIndex",
    "findLastIndex",
    "startsWith",
    "endsWith",
    "charAt",
    "at",
    "length",
];

/// Array methods that change their receiver in place.
const MUTATORS: &[&str] = &[
    "push",
    "pop",
    "shift",
    "unshift",
    "splice",
    "sort",
    "reverse",
    "fill",
    "copyWithin",
];

/// Array methods whose callback gets the receiver's elements.
const CALLBACK_METHODS: &[&str] = &[
    "map",
    "forEach",
    "filter",
    "find",
    "findLast",
    "findIndex",
    "findLastIndex",
    "some",
    "every",
    "flatMap",
    "reduce",
];

pub(super) fn check(f: &Func) -> Result<()> {
    let mut w = Walk::default();
    for p in &f.params {
        w.declare_pat(&p.pat, Origin::Param);
    }
    match &f.body {
        FnBody::Expr(e) => w.expr(e),
        FnBody::Block(b) => w.block(b),
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Origin {
    /// A new container nobody else holds.
    Fresh,
    /// May be the same container as another binding or element.
    Shared,
    /// A function parameter: by-reference when mutated (compile.rs), so writes reach the caller.
    Param,
    /// Not a container (number, string, boolean, null, a function...), or unknown but irrelevant.
    Scalar,
}

#[derive(Default)]
struct Walk {
    scopes: Vec<HashMap<String, Origin>>,
    /// Locals bound to a spread copy of a container: fresh at the top level, shared below it.
    spreads: Vec<HashSet<String>>,
    /// Locals bound to an object literal that is never written into: the keys it holds. A
    /// destructured key it lacks takes its default, a fresh value (`const { w = ["a"] } = {}`).
    literal_keys: HashMap<String, HashSet<String>>,
}

impl Walk {
    fn lookup(&self, name: &str) -> Option<Origin> {
        self.scopes.iter().rev().find_map(|s| s.get(name).copied())
    }

    fn declare(&mut self, name: &str, o: Origin) {
        if self.scopes.is_empty() {
            self.scopes.push(HashMap::new());
        }
        self.scopes.last_mut().unwrap().insert(name.to_string(), o);
    }

    fn declare_pat(&mut self, pat: &Pat, o: Origin) {
        match pat {
            Pat::Id(n, _) => self.declare(n, o),
            Pat::Default(p, _) => self.declare_pat(p, o),
            // A destructured element is the element itself, not a copy. Destructured parameters keep
            // `Param`: compile.rs rejects mutating through them with its own message.
            Pat::Obj { props, rest, .. } => {
                let inner = match o {
                    Origin::Fresh => Origin::Fresh,
                    Origin::Param => Origin::Param,
                    _ => Origin::Shared,
                };
                for (_, p) in props {
                    self.declare_pat(p, inner);
                }
                if let Some((n, _)) = rest {
                    self.declare(n, Origin::Fresh);
                }
            }
            Pat::Arr { elems, rest, .. } => {
                let inner = match o {
                    Origin::Fresh => Origin::Fresh,
                    Origin::Param => Origin::Param,
                    _ => Origin::Shared,
                };
                for p in elems.iter().flatten() {
                    self.declare_pat(p, inner);
                }
                if let Some((n, _)) = rest {
                    self.declare(n, Origin::Fresh);
                }
            }
        }
    }

    /// Where a value comes from, for a binding initialized or assigned from it.
    fn origin(&self, e: &Expr) -> Origin {
        match &e.kind {
            ExprKind::Num(_) | ExprKind::Str(_) | ExprKind::Bool(_) | ExprKind::Null | ExprKind::Undefined => {
                Origin::Scalar
            }
            ExprKind::Template(..) | ExprKind::Binary(..) | ExprKind::Unary(..) | ExprKind::IsNullish(..) => {
                Origin::Scalar
            }
            ExprKind::Func(_) | ExprKind::Regex { .. } => Origin::Scalar,
            // A literal is new, but a container placed inside it is still that container: the
            // literal's elements are what may be shared, not the literal.
            ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::New { .. } => Origin::Fresh,
            ExprKind::Ident(n) => match self.lookup(n) {
                Some(Origin::Scalar) => Origin::Scalar,
                Some(Origin::Fresh | Origin::Shared | Origin::Param) => Origin::Shared,
                // A captured module value or a global: shared with the config.
                None => Origin::Shared,
            },
            ExprKind::Member { prop, .. } if prop == "length" => Origin::Scalar,
            ExprKind::Member { .. } | ExprKind::Index { .. } => Origin::Shared,
            ExprKind::NonNull(x) | ExprKind::As(x, _) | ExprKind::Chain(x) | ExprKind::Await(x) => self.origin(x),
            ExprKind::Cond(_, a, b) | ExprKind::Logical(_, a, b) => match (self.origin(a), self.origin(b)) {
                (Origin::Scalar, Origin::Scalar) => Origin::Scalar,
                (Origin::Fresh | Origin::Scalar, Origin::Fresh | Origin::Scalar) => Origin::Fresh,
                _ => Origin::Shared,
            },
            ExprKind::Assign { value, .. } => self.origin(value),
            ExprKind::Update { .. } => Origin::Scalar,
            ExprKind::Call { callee, .. } => match &callee.kind {
                ExprKind::Member { prop, .. } if FRESH_METHODS.contains(&prop.as_str()) => Origin::Fresh,
                ExprKind::Member { obj, prop, .. }
                    if matches!(&obj.kind, ExprKind::Ident(g) if matches!(g.as_str(), "JSON" | "Math" | "Number" | "String" | "Object" | "Array"))
                        && !matches!(prop.as_str(), "assign") =>
                {
                    Origin::Fresh
                }
                // db calls, find/at/pop/shift (an element), user functions (may return an argument).
                ExprKind::Member { obj, .. } if matches!(&obj.kind, ExprKind::Ident(n) if n == "db") => Origin::Fresh,
                ExprKind::Member { obj, .. } if Self::is_db_chain(obj) => Origin::Fresh,
                _ => Origin::Shared,
            },
        }
    }

    fn is_db_chain(e: &Expr) -> bool {
        match &e.kind {
            ExprKind::Ident(n) => n == "db",
            ExprKind::Member { obj, .. } => Self::is_db_chain(obj),
            ExprKind::Call { callee, .. } => Self::is_db_chain(callee),
            ExprKind::Await(x) | ExprKind::Chain(x) | ExprKind::NonNull(x) => Self::is_db_chain(x),
            _ => false,
        }
    }

    /// The local an interior write ultimately goes into (`a.b[c].d` → `a`), when the write goes
    /// through at least one member/index step.
    fn written_root(target: &Expr) -> Option<&str> {
        fn root(e: &Expr) -> Option<&str> {
            match &e.kind {
                ExprKind::Ident(n) => Some(n),
                ExprKind::Member { obj, .. } | ExprKind::Index { obj, .. } => root(obj),
                ExprKind::NonNull(x) | ExprKind::As(x, _) | ExprKind::Chain(x) => root(x),
                _ => None,
            }
        }
        match &target.kind {
            ExprKind::Member { .. } | ExprKind::Index { .. } => root(target),
            ExprKind::NonNull(x) | ExprKind::As(x, _) => Self::written_root(x),
            _ => None,
        }
    }

    fn reject(name: &str, span: Span) -> Result<()> {
        err_help(
            span,
            format!(
                "`{name}` may be the same object or array as another value here, and compiled PHP copies it: this change wouldn't show up there"
            ),
            "change the original directly (for example `list[i].x = ...` instead of through a copy), or make an explicit copy first and use it from then on (`const b = { ...a }` / `[...a]`) — note a spread copy only copies the top level",
        )
    }

    fn write_into(&self, target: &Expr, span: Span) -> Result<()> {
        if let Some(name) = Self::written_root(target)
            && self.lookup(name) == Some(Origin::Shared)
        {
            return Self::reject(name, span);
        }
        Ok(())
    }

    fn block(&mut self, stmts: &[Stmt]) -> Result<()> {
        self.push();
        let r = stmts.iter().try_for_each(|s| self.stmt(s));
        self.pop();
        r
    }

    fn push(&mut self) {
        self.scopes.push(HashMap::new());
        self.spreads.push(HashSet::new());
    }

    fn pop(&mut self) {
        self.scopes.pop();
        self.spreads.pop();
    }

    fn stmt(&mut self, s: &Stmt) -> Result<()> {
        match s {
            Stmt::Decl { pat, init, .. } => {
                if let Some(e) = init {
                    self.expr(e)?;
                    if let (Pat::Obj { props, rest: None, .. }, ExprKind::Ident(src)) = (pat, &e.kind)
                        && let Some(keys) = self.literal_keys.get(src).cloned()
                    {
                        // Keys the literal lacks take their default (fresh); keys it has are its own
                        // members, shared with it.
                        for (key, p) in props {
                            let o = if keys.contains(key) {
                                Origin::Shared
                            } else {
                                self.default_origin(p)
                            };
                            self.declare_pat(p, o);
                        }
                        return Ok(());
                    }
                    if let (Pat::Id(n, _), ExprKind::Object(props)) = (pat, &e.kind)
                        && props.iter().all(|p| matches!(p, Prop::KV(PropKey::Static(_), _)))
                    {
                        let keys = props
                            .iter()
                            .filter_map(|p| match p {
                                Prop::KV(PropKey::Static(k), _) => Some(k.clone()),
                                _ => None,
                            })
                            .collect();
                        self.literal_keys.insert(n.clone(), keys);
                    }
                    self.declare_pat(pat, self.origin(e));
                    // A spread copy is shallow: its nested containers are shared with the source.
                    if let Pat::Id(n, _) = pat
                        && Self::spreads_shared(e, self)
                    {
                        if self.spreads.is_empty() {
                            self.spreads.push(HashSet::new());
                        }
                        self.spreads.last_mut().unwrap().insert(n.clone());
                    }
                } else {
                    self.declare_pat(pat, Origin::Scalar);
                }
            }
            Stmt::Expr(e) | Stmt::Throw(e) | Stmt::ExportDefault(e) => self.expr(e)?,
            Stmt::Return(Some(e), _) => self.expr(e)?,
            Stmt::If(t, a, b) => {
                self.expr(t)?;
                self.block(a)?;
                if let Some(b) = b {
                    self.block(b)?;
                }
            }
            Stmt::Block(b) => self.block(b)?,
            Stmt::While(t, b) => {
                self.expr(t)?;
                self.block(b)?;
            }
            Stmt::For {
                init,
                test,
                update,
                body,
                ..
            } => {
                self.push();
                if let Some(i) = init {
                    self.stmt(i)?;
                }
                if let Some(t) = test {
                    self.expr(t)?;
                }
                if let Some(u) = update {
                    self.expr(u)?;
                }
                self.block(body)?;
                self.pop();
            }
            Stmt::ForOf { pat, iter, body, .. } => {
                self.expr(iter)?;
                self.push();
                // Iterating a plain local by reference is faithful (compile.rs); any other source
                // (a derived array, a member) hands out elements another value still holds.
                let o = match &iter.kind {
                    ExprKind::Ident(n) if self.lookup(n) != Some(Origin::Shared) && self.lookup(n).is_some() => {
                        Origin::Param
                    }
                    // Elements of a fresh array (`[[1]]`, `list.filter(..)` is shared: its elements
                    // are the source's) belong to nobody else.
                    _ if matches!(iter.kind, ExprKind::Array(_)) => Origin::Fresh,
                    _ => Origin::Shared,
                };
                self.declare_pat(pat, o);
                self.block(body)?;
                self.pop();
            }
            Stmt::Try {
                block,
                param,
                handler,
                finalizer,
                ..
            } => {
                self.block(block)?;
                if let Some(h) = handler {
                    self.push();
                    if let Some((n, _)) = param {
                        self.declare(n, Origin::Scalar);
                    }
                    self.block(h)?;
                    self.pop();
                }
                if let Some(f) = finalizer {
                    self.block(f)?;
                }
            }
            Stmt::Switch { disc, cases, .. } => {
                self.expr(disc)?;
                for (t, b) in cases {
                    if let Some(t) = t {
                        self.expr(t)?;
                    }
                    self.block(b)?;
                }
            }
            Stmt::Exported(s) => self.stmt(s)?,
            // Nested function declarations are checked on their own (compile.rs calls `check` per function).
            Stmt::Func(_)
            | Stmt::Return(None, _)
            | Stmt::Break(_)
            | Stmt::Continue(_)
            | Stmt::TypeAlias { .. }
            | Stmt::Import { .. }
            | Stmt::ExportNames { .. }
            | Stmt::ExportAll { .. } => {}
        }
        Ok(())
    }

    /// `{ ...a }` / `[...a]` where `a` may hold containers: the copy's members are shared with `a`.
    fn spreads_shared(e: &Expr, w: &Walk) -> bool {
        let spread = |x: &Expr| !matches!(w.origin(x), Origin::Scalar);
        match &e.kind {
            ExprKind::Object(props) => props.iter().any(|p| matches!(p, Prop::Spread(x) if spread(x))),
            ExprKind::Array(items) => items.iter().any(|i| matches!(i, ArrEl::Spread(x) if spread(x))),
            _ => false,
        }
    }

    fn expr(&mut self, e: &Expr) -> Result<()> {
        match &e.kind {
            ExprKind::Assign { target, value, .. } => {
                self.expr(value)?;
                self.sub_exprs_of_place(target)?;
                if let ExprKind::Ident(n) = &target.kind {
                    // Rebinding a local: it now holds what the right side is.
                    let o = self.origin(value);
                    if self.lookup(n).is_some() {
                        self.rebind(n, o);
                    }
                    self.literal_keys.remove(n);
                } else {
                    if let Some(name) = Self::root_local(target) {
                        self.literal_keys.remove(name);
                    }
                    self.write_into(target, e.span)?;
                    self.write_nested_spread(target, e.span)?;
                }
            }
            ExprKind::Update { target, .. } => {
                self.sub_exprs_of_place(target)?;
                self.write_into(target, e.span)?;
                self.write_nested_spread(target, e.span)?;
            }
            ExprKind::Call { callee, args, .. } => {
                self.expr(callee)?;
                for a in args {
                    let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
                    self.expr(x)?;
                }
                if let ExprKind::Member { obj, prop, .. } = &callee.kind {
                    if MUTATORS.contains(&prop.as_str()) {
                        // `x.push(..)` writes into `x`; `a.list.push(..)` into `a`.
                        if let Some(name) = Self::root_local(obj)
                            && (self.lookup(name) == Some(Origin::Shared)
                                || (!matches!(obj.kind, ExprKind::Ident(_)) && self.spread_copy(name)))
                        {
                            return Self::reject(name, e.span);
                        }
                    }
                    // Elements of a fresh receiver (a literal, a map result) belong to nobody else, so
                    // changing them through the callback is invisible either way; only a receiver
                    // another value holds makes the copy observable.
                    if CALLBACK_METHODS.contains(&prop.as_str())
                        && self.origin(obj) != Origin::Fresh
                        && let Some(ArrEl::Item(cb)) = args.first()
                        && let ExprKind::Func(f) = &cb.kind
                    {
                        self.callback(f, prop)?;
                    }
                }
            }
            ExprKind::Array(items) => {
                for it in items {
                    let (ArrEl::Item(x) | ArrEl::Spread(x)) = it;
                    self.expr(x)?;
                }
            }
            ExprKind::Object(props) => {
                for p in props {
                    match p {
                        Prop::KV(k, x) => {
                            if let PropKey::Computed(k) = k {
                                self.expr(k)?;
                            }
                            self.expr(x)?;
                        }
                        Prop::Spread(x) => self.expr(x)?,
                    }
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
            ExprKind::New { args, .. } => {
                for a in args {
                    let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
                    self.expr(x)?;
                }
            }
            // Nested functions are checked on their own; callbacks above.
            ExprKind::Func(_)
            | ExprKind::Num(_)
            | ExprKind::Str(_)
            | ExprKind::Bool(_)
            | ExprKind::Null
            | ExprKind::Undefined
            | ExprKind::Regex { .. }
            | ExprKind::Ident(_) => {}
        }
        Ok(())
    }

    /// `b.n.x = 2` where `b = { ...a }`: `b.n` is `a.n`, so a write below the top level of a
    /// spread copy is a write into the shared source.
    fn write_nested_spread(&self, target: &Expr, span: Span) -> Result<()> {
        fn depth(e: &Expr) -> usize {
            match &e.kind {
                ExprKind::Member { obj, .. } | ExprKind::Index { obj, .. } => 1 + depth(obj),
                ExprKind::NonNull(x) | ExprKind::As(x, _) | ExprKind::Chain(x) => depth(x),
                _ => 0,
            }
        }
        if depth(target) >= 2
            && let Some(name) = Self::root_local(target)
            && self.spread_copy(name)
        {
            return Self::reject(name, span);
        }
        Ok(())
    }

    /// A destructured binding whose source key is missing: its default, if any, decides.
    fn default_origin(&self, p: &Pat) -> Origin {
        match p {
            Pat::Default(_, d) => match self.origin(d) {
                Origin::Fresh | Origin::Scalar => Origin::Fresh,
                o => o,
            },
            _ => Origin::Scalar,
        }
    }

    fn spread_copy(&self, name: &str) -> bool {
        self.spreads.iter().rev().any(|s| s.contains(name))
    }

    fn root_local(e: &Expr) -> Option<&str> {
        match &e.kind {
            ExprKind::Ident(n) => Some(n),
            ExprKind::Member { obj, .. } | ExprKind::Index { obj, .. } => Self::root_local(obj),
            ExprKind::NonNull(x) | ExprKind::As(x, _) | ExprKind::Chain(x) => Self::root_local(x),
            _ => None,
        }
    }

    /// Index expressions inside a write target still run (`a[i++] = 1`).
    fn sub_exprs_of_place(&mut self, target: &Expr) -> Result<()> {
        match &target.kind {
            ExprKind::Member { obj, .. } => self.sub_exprs_of_place(obj),
            ExprKind::Index { obj, index, .. } => {
                self.sub_exprs_of_place(obj)?;
                self.expr(index)
            }
            ExprKind::NonNull(x) | ExprKind::As(x, _) | ExprKind::Chain(x) => self.sub_exprs_of_place(x),
            _ => Ok(()),
        }
    }

    fn rebind(&mut self, name: &str, o: Origin) {
        for s in self.scopes.iter_mut().rev() {
            if let Some(slot) = s.get_mut(name) {
                *slot = o;
                return;
            }
        }
    }

    /// A callback's element parameter is an element of the receiver: compiled PHP passes it by
    /// value, so writing into it is lost. Rejected with the `for...of` fix (whose by-reference
    /// loop is faithful).
    fn callback(&mut self, f: &Func, method: &str) -> Result<()> {
        let element = if method == "reduce" {
            f.params.get(1)
        } else {
            f.params.first()
        };
        let accumulator = if method == "reduce" { f.params.first() } else { None };
        let mut names = Vec::new();
        for p in element.into_iter().chain(accumulator) {
            if let Pat::Id(n, _) = &p.pat {
                names.push(n.clone());
            }
        }
        if names.is_empty() {
            return Ok(());
        }
        let mut inner = Walk {
            scopes: vec![names.iter().map(|n| (n.clone(), Origin::Shared)).collect()],
            spreads: vec![HashSet::new()],
            literal_keys: HashMap::new(),
        };
        let body_result = match &f.body {
            FnBody::Expr(e) => inner.expr(e),
            FnBody::Block(b) => inner.block(b),
        };
        body_result.map_err(|d| {
            Diag::new(
                d.span,
                format!("`{method}` passes each element to the callback as a copy in compiled PHP, so this change would be lost"),
            )
            .help("use `for (const item of list) { item.x = ... }`, which changes the elements themselves")
        })
    }
}

/// `list[i] = v` past the end leaves holes JS fills with `undefined` but a PHP array turns into a
/// keyed map (`[1, , , 2]` vs `{"0":1,"3":2}`). A plain `=` into an array by index is refused;
/// changing an existing element (`list[i]++`, `list[i] += 1`, `list[i].x = ...`) is not a write past
/// the end and stays.
pub(super) fn index_write(span: Span) -> Result<()> {
    err_help(
        span,
        "assigning to an array index can leave holes, which compiled PHP turns into an object",
        "use `list.push(value)` to append, or build the array with `map`/`Array.from`",
    )
}
