//! The ownership rule. JavaScript objects and arrays are references; compiled PHP arrays are
//! values, copied on assignment, on return and when passed. A write is faithful only when the
//! container it changes has one name, so the compiler accepts a write into a container only
//! through its **owner**, and only **before the owner shares it**.
//!
//! - A write is `o.k = v`, `o[i] = v`, `o.k++`, a mutator call (`o.push(v)`, `sort`, `splice`,
//!   ...), or passing `o` to a program function that writes that parameter. Its root is `o`.
//! - An **owner** is a local of the function being checked that was declared from a fresh value
//!   (an object or array literal of fresh values, a spread copy whose members can't be
//!   containers, `new`, `JSON.parse`, `Object.keys`, a db query, or `map`/`filter`/`slice`/...
//!   whose elements can't be containers), or a plain parameter (compile.rs passes a mutated
//!   parameter by reference, and the caller's argument is checked by this same rule).
//! - The owner **shares** its container by: initializing or being assigned to another binding,
//!   being stored into a container or literal, returned, thrown, iterated or read from by an
//!   array method, or passed to a call that may keep it or beside an argument the call writes.
//!   Capturing is not sharing: compiled closures capture a written binding by reference. Sharing is tracked in evaluation order; branches join, and
//!   each loop body is walked twice so a share late in an iteration counts for the next one.
//! - A write below the top level (`o.k.j = v`) also needs every value placed into `o` to have
//!   been fresh.
//! - A `for (const e of o)` element is a view of `o` when compiled PHP loops by reference (the
//!   body writes `e`): writes through `e` are writes into `o`. An element of a literal of fresh
//!   values (`for (const e of [{ n: 1 }])`) is an owner.
//!
//! **Functions are checked one at a time, and a closure is a function.** Inside a closure,
//! including an array-method callback, the only owners are the closure's own locals created and
//! written there before being shared (`rows.map((r) => { const o = {}; o.x = r.x; return o; })`).
//! Everything else it can reach is refused: captured bindings (`out.push(r)` inside `forEach`),
//! its parameters (a callback's element is a copy in PHP; a reducer's accumulator is too), and
//! anything reached through them. Each refusal gives the `for...of` rewrite. The rule refuses
//! programs JS would run the same way; it accepts none whose compiled PHP differs through sharing.

use super::*;

/// Calls whose result is a new container holding nothing taken from anywhere.
const FRESH_CALLS: &[&str] = &[
    "keys", "split", "join", "toFixed", "toString", "match", "matchAll", "exec",
];

/// Calls whose result is a new array holding the receiver's elements.
const SHALLOW_CALLS: &[&str] = &[
    "map",
    "filter",
    "slice",
    "concat",
    "flat",
    "flatMap",
    "toSorted",
    "toReversed",
    "with",
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

/// What compile.rs learned: the type of each compiled expression, and the program-wide effects.
pub(super) struct Oracle<'a> {
    pub types: &'a HashMap<Span, Ty>,
    pub effects: &'a effects::Effects,
}

pub(super) fn container(t: &Ty) -> bool {
    match t {
        Ty::Union(ts) => ts.iter().any(container),
        Ty::Array(_) | Ty::Tuple(_) | Ty::ArrayLiteral(_) | Ty::Obj(_) | Ty::Map(_) | Ty::Unknown => true,
        Ty::Promise(t) => container(t),
        _ => false,
    }
}

/// Whether a value of type `t` can hold containers inside it.
fn nests(t: &Ty) -> bool {
    match t {
        Ty::Union(ts) => ts.iter().any(nests),
        Ty::Array(t) | Ty::Map(t) | Ty::Promise(t) => container(t),
        Ty::Tuple(ts) | Ty::ArrayLiteral(ts) => ts.iter().any(container),
        Ty::Obj(fields) => fields.values().any(|(t, _)| container(t)),
        Ty::Unknown => true,
        _ => false,
    }
}

pub(super) fn check(f: &Func, oracle: &Oracle<'_>) -> Result<()> {
    Walk {
        oracle,
        scopes: Vec::new(),
        st: HashMap::new(),
        callback: None,
    }
    .function(f, None)
}

#[derive(Clone, Copy, Default, PartialEq)]
struct Local {
    /// Declared in the function being walked from a fresh value, or a plain parameter.
    owner: bool,
    /// Shared: no more writes through it.
    shared: bool,
    /// Something not fresh was placed into it.
    holds_shared: bool,
    /// A `for...of` element looped by reference: (binding it writes into, steps below).
    view: Option<(Span, usize)>,
}

struct Walk<'o, 'a> {
    oracle: &'o Oracle<'a>,
    /// Per function being walked (outermost first): its names → bindings.
    scopes: Vec<Vec<HashMap<String, Span>>>,
    /// The state of the innermost function's locals.
    st: HashMap<Span, Local>,
    /// Inside an array-method callback: the method's name, for messages.
    callback: Option<String>,
}

fn join(a: &mut HashMap<Span, Local>, b: &HashMap<Span, Local>) {
    for (k, l) in b {
        let x = a.entry(*k).or_insert(*l);
        x.owner &= l.owner;
        x.shared |= l.shared;
        x.holds_shared |= l.holds_shared;
        x.view = x.view.or(l.view);
    }
}

impl Walk<'_, '_> {
    /// Walk a function on its own: only its own locals can be owners.
    fn function(&mut self, f: &Func, callback: Option<String>) -> Result<()> {
        let saved = (
            std::mem::take(&mut self.st),
            std::mem::replace(&mut self.callback, callback),
        );
        self.scopes.push(vec![HashMap::new()]);
        let r = (|| {
            for p in &f.params {
                // A callback's parameters are copies of elements (or the carried accumulator).
                let param_owner = self.callback.is_none() && matches!(p.pat, Pat::Id(..));
                self.declare_pat(&p.pat, param_owner);
                if let Some(d) = &p.default {
                    self.expr(d)?;
                    self.share(d);
                }
            }
            match &f.body {
                FnBody::Expr(e) => {
                    self.expr(e)?;
                    self.share(e);
                    Ok(())
                }
                FnBody::Block(b) => self.stmts(b).map(|_| ()),
            }
        })();
        self.scopes.pop();
        (self.st, self.callback) = saved;
        r
    }

    /// A binding of the innermost function, or `None` (an outer binding, a module value).
    fn lookup(&self, name: &str) -> Option<Span> {
        self.scopes.last()?.iter().rev().find_map(|s| s.get(name).copied())
    }

    /// Whether `name` is a binding of an enclosing function (captured by this one).
    fn captured(&self, name: &str) -> bool {
        let n = self.scopes.len();
        self.lookup(name).is_none()
            && self.scopes[..n.saturating_sub(1)]
                .iter()
                .any(|f| f.iter().any(|s| s.contains_key(name)))
    }

    fn holds_container(&self, e: &Expr) -> bool {
        self.oracle.types.get(&e.span).is_none_or(container)
    }

    fn nests(&self, e: &Expr) -> bool {
        self.oracle.types.get(&e.span).is_none_or(nests)
    }

    fn root(e: &Expr) -> Option<(&str, usize)> {
        match &e.kind {
            ExprKind::Ident(n) => Some((n, 0)),
            ExprKind::Member { obj, .. } | ExprKind::Index { obj, .. } => Self::root(obj).map(|(n, d)| (n, d + 1)),
            ExprKind::NonNull(x) | ExprKind::As(x, _) | ExprKind::Chain(x) => Self::root(x),
            _ => None,
        }
    }

    fn root_binding(&self, e: &Expr) -> Option<Span> {
        Self::root(e).and_then(|(n, _)| self.lookup(n))
    }

    fn declare(&mut self, name: &str, span: Span, owner: bool) {
        self.scopes
            .last_mut()
            .and_then(|f| f.last_mut())
            .expect("scope")
            .insert(name.to_string(), span);
        self.st.insert(
            span,
            Local {
                owner,
                ..Local::default()
            },
        );
    }

    /// Destructured members are read out of a container: owners only when the source was a fresh
    /// literal (`const { words = ["a"] } = { words: undefined }`) and the member's own value or
    /// default is fresh.
    fn declare_pat(&mut self, pat: &Pat, owner: bool) {
        match pat {
            Pat::Id(n, s) => self.declare(n, *s, owner),
            Pat::Default(p, d) => {
                // The member may be missing, or the source may hold a container there; only the
                // missing case gives the (fresh) default.
                let fresh_default = !self.holds_container(d) || self.new_container(d);
                self.declare_pat(p, owner && fresh_default);
            }
            Pat::Obj { props, rest, .. } => {
                for (_, p) in props {
                    self.declare_pat(p, owner);
                }
                if let Some((n, s)) = rest {
                    self.declare(n, *s, false);
                }
            }
            Pat::Arr { elems, rest, .. } => {
                for p in elems.iter().flatten() {
                    self.declare_pat(p, owner);
                }
                if let Some((n, s)) = rest {
                    self.declare(n, *s, false);
                }
            }
        }
    }

    // ---- freshness and sharing -------------------------------------------------------------

    /// Whether `e` evaluates to a container made right here (nobody else holds it).
    fn new_container(&self, e: &Expr) -> bool {
        match &e.kind {
            ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::New { .. } => true,
            ExprKind::NonNull(x) | ExprKind::As(x, _) | ExprKind::Await(x) | ExprKind::Chain(x) => {
                self.new_container(x)
            }
            ExprKind::Cond(_, a, b) | ExprKind::Logical(_, a, b) => self.new_container(a) && self.new_container(b),
            ExprKind::Call { callee, .. } if !self.oracle.effects.program_call(e.span) => match &callee.kind {
                ExprKind::Member { obj, .. } if is_db_chain(obj) => true,
                ExprKind::Member { obj, prop, .. } => match self.global(obj) {
                    Some(g) => matches!(
                        (g, prop.as_str()),
                        ("Object", "keys" | "values" | "entries") | ("JSON", "parse") | ("Array", "from")
                    ),
                    None => FRESH_CALLS.contains(&prop.as_str()) || SHALLOW_CALLS.contains(&prop.as_str()),
                },
                _ => false,
            },
            _ => false,
        }
    }

    /// Whether `e` is a new container holding nothing anyone else holds (or not a container).
    fn fresh(&self, e: &Expr) -> bool {
        if !self.holds_container(e) {
            return true;
        }
        if !self.new_container(e) {
            return false;
        }
        match &e.kind {
            ExprKind::Array(items) => items.iter().all(|it| match it {
                ArrEl::Item(x) => self.fresh(x),
                ArrEl::Spread(x) => !self.nests(x),
            }),
            ExprKind::Object(props) => props.iter().all(|p| match p {
                Prop::KV(_, x) => self.fresh(x),
                Prop::Spread(x) => !self.nests(x),
            }),
            ExprKind::New { .. } => true,
            ExprKind::NonNull(x) | ExprKind::As(x, _) | ExprKind::Await(x) | ExprKind::Chain(x) => self.fresh(x),
            ExprKind::Cond(_, a, b) | ExprKind::Logical(_, a, b) => self.fresh(a) && self.fresh(b),
            // db rows, JSON.parse and Object.keys hold nothing of ours; the rest hold elements.
            ExprKind::Call { callee, .. } => match &callee.kind {
                ExprKind::Member { obj, prop, .. } => {
                    is_db_chain(obj)
                        || matches!(
                            (self.global(obj), prop.as_str()),
                            (Some("Object"), "keys") | (Some("JSON"), "parse")
                        )
                        || FRESH_CALLS.contains(&prop.as_str())
                        || !self.nests(e)
                }
                _ => false,
            },
            _ => false,
        }
    }

    /// `e`'s container gets another holder: the binding at its root is shared.
    fn share(&mut self, e: &Expr) {
        if !self.holds_container(e) {
            return;
        }
        match &e.kind {
            ExprKind::Ident(_) => {
                if let Some(b) = self.root_binding(e) {
                    self.share_binding(b);
                }
            }
            // Part of the root is shared: writes into the root's top level stay faithful, writes
            // below it may reach the shared part.
            ExprKind::Member { .. } | ExprKind::Index { .. } => {
                if let Some(b) = self.root_binding(e) {
                    let view = self.st.get(&b).and_then(|l| l.view);
                    for k in std::iter::once(b).chain(view.map(|v| v.0)) {
                        self.st.entry(k).or_default().holds_shared = true;
                    }
                }
            }
            ExprKind::NonNull(x) | ExprKind::As(x, _) | ExprKind::Await(x) | ExprKind::Chain(x) => self.share(x),
            ExprKind::Cond(_, a, b) | ExprKind::Logical(_, a, b) => {
                self.share(a);
                self.share(b);
            }
            ExprKind::Assign { value, .. } => self.share(value),
            ExprKind::Array(items) => items.iter().for_each(|it| {
                let (ArrEl::Item(x) | ArrEl::Spread(x)) = it;
                self.hand_into(x, matches!(it, ArrEl::Spread(_)))
            }),
            ExprKind::Object(props) => props.iter().for_each(|p| {
                let (Prop::KV(_, x) | Prop::Spread(x)) = p;
                self.hand_into(x, matches!(p, Prop::Spread(_)))
            }),
            // A call result may be the receiver, an element of it, or an argument — unless it's
            // a container holding nothing of theirs (`Object.keys`, `JSON.parse`, a db query).
            ExprKind::Call { callee, args, .. } if !self.fresh(e) => {
                if let ExprKind::Member { obj, .. } = &callee.kind {
                    self.share(obj);
                }
                for a in args {
                    let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
                    self.share(x);
                }
            }
            _ => {}
        }
    }

    fn share_binding(&mut self, b: Span) {
        let view = self.st.get(&b).and_then(|l| l.view);
        for k in std::iter::once(b).chain(view.map(|v| v.0)) {
            self.st.entry(k).or_default().shared = true;
        }
    }

    /// `x` goes into a new container: shared whole, or (a spread) only its members are.
    fn hand_into(&mut self, x: &Expr, spread: bool) {
        if !spread {
            return self.share(x);
        }
        if self.nests(x)
            && let Some(b) = self.root_binding(x)
        {
            self.st.entry(b).or_default().holds_shared = true;
        }
    }

    /// `value` is placed into the container at `holder`'s root.
    fn place(&mut self, holder: &Expr, value: &Expr) {
        if self.holds_container(value)
            && !self.fresh(value)
            && let Some(b) = self.root_binding(holder)
        {
            self.st.entry(b).or_default().holds_shared = true;
        }
        self.share(value);
    }

    // ---- writes ----------------------------------------------------------------------------

    /// A write `extra` steps below the place `target`.
    fn write(&self, target: &Expr, extra: usize, span: Span) -> Result<()> {
        let Some((name, d)) = Self::root(target) else {
            // A new container made right here (`[...list].sort()`, `[b, a].reverse()`) is the
            // same value whatever reads it next; a write below its top level reaches its members.
            return if self.new_container(target) && (extra <= 1 || self.fresh(target)) {
                Ok(())
            } else {
                self.refuse(span, "this value", None)
            };
        };
        let mut depth = d + extra;
        if depth == 0 {
            return Ok(());
        }
        let mut l = self.lookup(name).and_then(|b| self.st.get(&b).copied());
        if let Some((r, vd)) = l.and_then(|l| l.view) {
            l = self.st.get(&r).copied();
            depth += vd;
        }
        match l {
            Some(l) if l.owner && !l.shared && (depth == 1 || !l.holds_shared) => Ok(()),
            l => self.refuse(span, name, l),
        }
    }

    fn refuse(&self, span: Span, name: &str, l: Option<Local>) -> Result<()> {
        if let Some(m) = &self.callback {
            return err_help(
                span,
                format!(
                    "`{m}` runs this callback on copies in compiled PHP, so changing `{name}` here wouldn't show up outside it"
                ),
                "loop instead and change things there: `for (const item of list) { ... }` (build a new value inside the callback only if it never leaves it changed)",
            );
        }
        let help = match l {
            Some(l) if l.shared => {
                "make the change before storing, returning or passing it on, or change a fresh copy (`const copy = { ...value }`)"
            }
            Some(l) if l.owner => {
                "a nested value here came from elsewhere: build it fresh before storing it, or change it through its own binding"
            }
            _ => {
                "make a fresh copy first (`const copy = { ...value }` / `[...list]`) and change the copy, or build the new value directly"
            }
        };
        err_help(
            span,
            format!(
                "`{name}` may be the same object or array as another value here, and compiled PHP copies it: this change wouldn't show up there"
            ),
            help,
        )
    }

    // ---- statements ------------------------------------------------------------------------

    /// Returns whether the statements always return or throw.
    fn stmts(&mut self, stmts: &[Stmt]) -> Result<bool> {
        self.scopes.last_mut().expect("function").push(HashMap::new());
        let mut ends = false;
        for s in stmts {
            if self.stmt(s)? {
                ends = true;
                break;
            }
        }
        self.scopes.last_mut().expect("function").pop();
        Ok(ends)
    }

    /// Walk a loop body twice: a share late in one iteration counts for the next.
    fn twice(&mut self, mut body: impl FnMut(&mut Self) -> Result<()>) -> Result<()> {
        let entry = self.st.clone();
        body(self)?;
        join(&mut self.st, &entry);
        body(self)?;
        join(&mut self.st, &entry);
        Ok(())
    }

    fn stmt(&mut self, s: &Stmt) -> Result<bool> {
        match s {
            Stmt::Decl { pat, init, .. } => {
                let (owner, fresh) = match init {
                    Some(e) => {
                        self.expr(e)?;
                        // Destructuring reads members out of the value: only those it binds are
                        // shared with it (and a rest is a shallow copy).
                        if matches!(pat, Pat::Id(..)) {
                            self.share(e);
                        } else if self.nests(e)
                            && let Some(b) = self.root_binding(e)
                        {
                            self.st.entry(b).or_default().holds_shared = true;
                        }
                        let new = !self.holds_container(e) || self.new_container(e);
                        // Destructuring keeps owners only out of a fresh literal: a member taken out
                        // of a binding is still that binding's member in JS.
                        let owner = match pat {
                            Pat::Id(..) => new,
                            _ => new && self.fresh(e),
                        };
                        (owner, self.fresh(e))
                    }
                    None => (true, true),
                };
                self.declare_pat(pat, owner);
                if let Pat::Id(_, span) = pat {
                    self.st.entry(*span).or_default().holds_shared = !fresh;
                }
            }
            Stmt::Expr(e) => self.expr(e)?,
            Stmt::Return(Some(e), _) | Stmt::Throw(e) => {
                self.expr(e)?;
                self.share(e);
                return Ok(true);
            }
            Stmt::Return(None, _) => return Ok(true),
            Stmt::ExportDefault(e) => {
                self.expr(e)?;
                self.share(e);
            }
            Stmt::If(t, a, b) => {
                self.expr(t)?;
                let entry = self.st.clone();
                let a_ends = self.stmts(a)?;
                let after_a = std::mem::replace(&mut self.st, entry);
                let b_ends = match b {
                    Some(b) => self.stmts(b)?,
                    None => false,
                };
                match (a_ends, b_ends) {
                    (true, true) => return Ok(true),
                    (true, false) => {}
                    (false, true) => self.st = after_a,
                    (false, false) => join(&mut self.st, &after_a),
                }
            }
            Stmt::Block(b) => return self.stmts(b),
            Stmt::While(t, b) => {
                self.expr(t)?;
                self.twice(|w| {
                    w.stmts(b)?;
                    w.expr(t)
                })?;
            }
            Stmt::For {
                init,
                test,
                update,
                body,
                ..
            } => {
                self.scopes.last_mut().expect("function").push(HashMap::new());
                if let Some(i) = init {
                    self.stmt(i)?;
                    // A captured loop variable is copied into a fresh cell each iteration.
                    if let Stmt::Decl { pat, .. } = &**i {
                        let mut names = Vec::new();
                        bindings(pat, &mut names);
                        for (_, b) in names {
                            if self.oracle.effects.captured(b) {
                                self.share_binding(b);
                            }
                        }
                    }
                }
                self.twice(|w| {
                    if let Some(t) = test {
                        w.expr(t)?;
                    }
                    w.stmts(body)?;
                    if let Some(u) = update {
                        w.expr(u)?;
                    }
                    Ok(())
                })?;
                self.scopes.last_mut().expect("function").pop();
            }
            Stmt::ForOf { pat, iter, body, .. } => {
                self.expr(iter)?;
                let view = match (pat, Self::root(iter)) {
                    (Pat::Id(..), Some((n, d))) if self.oracle.effects.by_ref(pat) => self.lookup(n).map(|r| {
                        let (base, extra) = self.st.get(&r).and_then(|l| l.view).unwrap_or((r, 0));
                        (base, extra + d + 1)
                    }),
                    _ => None,
                };
                if view.is_none() {
                    self.share(iter);
                }
                // The elements of a literal of fresh values belong to nobody else.
                let own = matches!(iter.kind, ExprKind::Array(_)) && self.fresh(iter);
                self.twice(|w| {
                    w.scopes.last_mut().expect("function").push(HashMap::new());
                    w.declare_pat(pat, own);
                    if let (Some(v), Pat::Id(_, span)) = (view, pat) {
                        w.st.entry(*span).or_default().view = Some(v);
                    }
                    w.stmts(body)?;
                    w.scopes.last_mut().expect("function").pop();
                    Ok(())
                })?;
            }
            Stmt::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                let entry = self.st.clone();
                let block_ends = self.stmts(block)?;
                let mut ends = block_ends;
                if let Some(h) = handler {
                    // The handler may start anywhere in the block.
                    let after = self.st.clone();
                    join(&mut self.st, &entry);
                    self.scopes.last_mut().expect("function").push(HashMap::new());
                    if let Some((n, span)) = param {
                        self.declare(n, *span, false);
                    }
                    let h_ends = self.stmts(h)?;
                    self.scopes.last_mut().expect("function").pop();
                    if !block_ends {
                        join(&mut self.st, &after);
                    }
                    ends = block_ends && h_ends;
                }
                if let Some(f) = finalizer {
                    ends |= self.stmts(f)?;
                }
                return Ok(ends);
            }
            Stmt::Switch { disc, cases, .. } => {
                self.expr(disc)?;
                let entry = self.st.clone();
                let mut out = entry.clone();
                for (t, b) in cases {
                    // A case may be reached directly or by falling through from any before it.
                    join(&mut self.st, &entry);
                    if let Some(t) = t {
                        self.expr(t)?;
                    }
                    self.stmts(b)?;
                    join(&mut out, &self.st);
                }
                self.st = out;
            }
            Stmt::Exported(s) => return self.stmt(s),
            Stmt::Func(f) => self.closure(f, None)?,
            Stmt::Break(_)
            | Stmt::Continue(_)
            | Stmt::TypeAlias { .. }
            | Stmt::Import { .. }
            | Stmt::ExportNames { .. }
            | Stmt::ExportAll { .. } => {}
        }
        Ok(false)
    }

    /// A nested function: checked on its own. Capturing doesn't share: compiled closures capture
    /// a binding that anything writes by reference (`use (&$x)`), so the closure sees the
    /// owner's writes; a closure can't write what it captured (rule above).
    fn closure(&mut self, f: &Func, callback: Option<String>) -> Result<()> {
        if let Some(n) = &f.name {
            self.declare(n, f.span, false);
        }
        self.function(f, callback)
    }

    // ---- expressions -----------------------------------------------------------------------

    fn exprs(&mut self, args: &[ArrEl]) -> Result<()> {
        args.iter().try_for_each(|a| {
            let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
            self.expr(x)
        })
    }

    fn expr(&mut self, e: &Expr) -> Result<()> {
        match &e.kind {
            ExprKind::Assign { target, value, .. } => {
                self.expr(value)?;
                match &target.kind {
                    ExprKind::Ident(n) => {
                        let (new, fresh) = (
                            !self.holds_container(value) || self.new_container(value),
                            self.fresh(value),
                        );
                        self.share(value);
                        if let Some(b) = self.lookup(n) {
                            let l = self.st.entry(b).or_default();
                            l.owner &= new;
                            l.holds_shared |= !fresh;
                        }
                        // A captured binding reassigned in a closure: closures capture by
                        // reference, so the outer binding sees the new value (not a write into
                        // a container).
                    }
                    ExprKind::Member { obj, .. } | ExprKind::Index { obj, .. } => {
                        if let ExprKind::Index { index, .. } = &target.kind {
                            self.expr(index)?;
                        }
                        self.expr(obj)?;
                        self.write(target, 0, e.span)?;
                        self.place(obj, value);
                    }
                    _ => self.expr(target)?,
                }
            }
            ExprKind::Update { target, .. } => {
                if let ExprKind::Member { obj, .. } | ExprKind::Index { obj, .. } = &target.kind {
                    if let ExprKind::Index { index, .. } = &target.kind {
                        self.expr(index)?;
                    }
                    self.expr(obj)?;
                    self.write(target, 0, e.span)?;
                }
            }
            ExprKind::Call { callee, args, .. } => self.call(e, callee, args)?,
            // Each item is held by the new container from the moment it's evaluated (PHP copies
            // it in then: `[a, a.x++]` must not write `a` after placing it).
            ExprKind::Array(items) => {
                for it in items {
                    let (ArrEl::Item(x) | ArrEl::Spread(x)) = it;
                    self.expr(x)?;
                    self.hand_into(x, matches!(it, ArrEl::Spread(_)));
                }
            }
            ExprKind::Object(props) => {
                for p in props {
                    if let Prop::KV(PropKey::Computed(k), _) = p {
                        self.expr(k)?;
                    }
                    let (Prop::KV(_, x) | Prop::Spread(x)) = p;
                    self.expr(x)?;
                    self.hand_into(x, matches!(p, Prop::Spread(_)));
                }
            }
            ExprKind::New { callee, args } => {
                self.expr(callee)?;
                self.exprs(args)?;
                for a in args {
                    let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
                    self.share(x);
                }
            }
            ExprKind::Func(f) => self.closure(f, None)?,
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
            ExprKind::Template(_, xs) => xs.iter().try_for_each(|x| self.expr(x))?,
            ExprKind::Num(_)
            | ExprKind::Str(_)
            | ExprKind::Bool(_)
            | ExprKind::Null
            | ExprKind::Undefined
            | ExprKind::Regex { .. }
            | ExprKind::Ident(_) => {}
        }
        Ok(())
    }

    fn global<'e>(&self, obj: &'e Expr) -> Option<&'e str> {
        match &obj.kind {
            ExprKind::Ident(g) if self.lookup(g).is_none() && !self.captured(g) && GLOBALS.contains(&g.as_str()) => {
                Some(g)
            }
            _ => None,
        }
    }

    fn call(&mut self, e: &Expr, callee: &Expr, args: &[ArrEl]) -> Result<()> {
        let fx = self.oracle.effects;
        let program = fx.program_call(e.span);
        if let ExprKind::Member { obj, prop, .. } = &callee.kind
            && !program
        {
            self.expr(obj)?;
            if is_db_chain(obj) {
                return self.exprs(args);
            }
            for a in args {
                let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
                match &x.kind {
                    // A function passed to a method or builtin (`map`, `Array.from`, `sort`, ...)
                    // is a callback: checked on its own, owning only what it creates.
                    ExprKind::Func(f) => self.closure(f, Some(prop.clone()))?,
                    _ => {
                        self.expr(x)?;
                        // A named function as a callback writing its element, or anything it
                        // captured: refused like an inline callback would be.
                        if (0..2).any(|i| fx.callback_writes_param(e.span, i)) || fx.callback_writes_captures(e.span) {
                            return err_help(
                                x.span,
                                format!(
                                    "`{prop}` runs this function on copies in compiled PHP, so the changes it makes wouldn't show up"
                                ),
                                "loop instead and change things there: `for (const item of list) { ... }`",
                            );
                        }
                    }
                }
            }
            if self.global(obj).is_some() {
                // Builtins read their arguments; `Object.assign` writes its first.
                if prop == "assign"
                    && let Some(ArrEl::Item(t)) = args.first()
                {
                    self.write(t, 1, e.span)?;
                    for a in &args[1..] {
                        let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
                        self.place(t, x);
                    }
                }
                return Ok(());
            }
            if MUTATORS.contains(&prop.as_str()) {
                self.write(obj, 1, e.span)?;
                for a in args {
                    let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
                    self.place(obj, x);
                }
            } else if args.iter().any(|a| {
                matches!(
                    a,
                    ArrEl::Item(Expr {
                        kind: ExprKind::Func(_),
                        ..
                    })
                )
            }) {
                // An array method walking its receiver hands out its elements.
                self.share(obj);
            }
            return Ok(());
        }
        // A program function, or an unknown callee (which may keep anything).
        self.expr(callee)?;
        let by_ref: Vec<usize> = (0..args.len())
            .filter(|i| program && fx.argument_by_ref(e.span, *i))
            .collect();
        // A container passed by value is copied when the call starts, so a later argument
        // writing it (`read(a, a.x++)`) would change JS's argument but not PHP's: once evaluated,
        // a by-value argument counts as shared for the rest of the argument list.
        let mut lent = Vec::new();
        for (i, a) in args.iter().enumerate() {
            let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
            self.expr(x)?;
            if !by_ref.contains(&i)
                && self.holds_container(x)
                && let Some(b) = self.root_binding(x)
                && !self.st.get(&b).is_some_and(|l| l.shared)
            {
                self.st.entry(b).or_default().shared = true;
                lent.push(b);
            }
        }
        for b in lent {
            self.st.entry(b).or_default().shared = false;
        }
        // Two arguments naming one container (`both(o, o)`): JS's parameters are one object,
        // PHP's by-reference one is not the other.
        let roots: Vec<Option<Span>> = args
            .iter()
            .map(|a| {
                let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
                self.holds_container(x).then(|| self.root_binding(x)).flatten()
            })
            .collect();
        for (i, a) in args.iter().enumerate() {
            let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
            if by_ref.contains(&i) && !matches!(x.kind, ExprKind::Null | ExprKind::Undefined) {
                if roots[i].is_some() && roots.iter().enumerate().any(|(j, r)| j != i && *r == roots[i]) {
                    return self.refuse(x.span, Self::root(x).map_or("this value", |r| r.0), None);
                }
                self.write(x, 1, x.span)?;
            }
        }
        for (i, a) in args.iter().enumerate() {
            let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
            // Kept by the callee, or passed beside an argument it writes (the two may be one
            // container, and only one of them goes by reference).
            let beside = !self.fresh(x) && by_ref.iter().any(|j| *j != i);
            // Returned as (part of) a container result, stored, or unknown: shared.
            let kept = fx.stores_argument(e.span, i) || (fx.returns_argument(e.span, i) && self.holds_container(e));
            if !program || kept || beside {
                self.share(x);
            }
        }
        // A helper writing values it captured (a module or outer value) from inside a closure.
        if program && self.scopes.len() > 1 && fx.writes_captures(e.span) {
            return self.refuse(e.span, "this call", None);
        }
        Ok(())
    }
}

fn bindings(p: &Pat, out: &mut Vec<(String, Span)>) {
    match p {
        Pat::Id(n, s) => out.push((n.clone(), *s)),
        Pat::Default(p, _) => bindings(p, out),
        Pat::Obj { props, rest, .. } => {
            props.iter().for_each(|(_, p)| bindings(p, out));
            out.extend(rest.clone());
        }
        Pat::Arr { elems, rest, .. } => {
            elems.iter().flatten().for_each(|p| bindings(p, out));
            out.extend(rest.clone());
        }
    }
}

fn is_db_chain(e: &Expr) -> bool {
    match &e.kind {
        ExprKind::Ident(n) => n == "db",
        ExprKind::Member { obj, .. } => is_db_chain(obj),
        ExprKind::Call { callee, .. } => is_db_chain(callee),
        ExprKind::Await(x) | ExprKind::Chain(x) | ExprKind::NonNull(x) => is_db_chain(x),
        _ => false,
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
