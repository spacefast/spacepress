//! Reject-first sharing check. JavaScript shares objects and arrays by reference; compiled PHP
//! copies arrays on assignment, on return and when passing by value. Changing a container that
//! another live value also holds would show up in JS and silently not in PHP, so it is a build
//! error with a located fix.
//!
//! The walk is flow-sensitive within a compiled function, and nested closures are walked with
//! their enclosing function's state (they share its bindings). Each local that holds a container
//! has a set of *tags*; two locals with a common tag may be the same container. A tag is
//! *shared* when something other than one local may hold it: a second local, a container it was
//! stored in, a closure that keeps it, a parameter's caller, a module value, an element read. A
//! tag's *inner* tags are the containers it holds (a literal's members, a stored value).
//!
//! Writing into a local (`x.k = v`, `x[i] = v`, `x.k++`, `x.push(..)`, `Object.assign(x, ..)`, a
//! call whose callee writes its parameter) is refused when any of its tags is shared; writing two
//! or more levels below it (`x.k.j = v`, `x.k.push(..)`) is refused when a tag inner to it is
//! shared. A parameter itself is exempt from the first rule: compile.rs passes a mutated
//! parameter by reference, so those writes reach its caller.
//!
//! Joins: after `if`/`?:`/`&&`/`switch`/`try`, a local carries every tag any path gave it; a loop
//! body is walked until the state it leaves stops changing. A closure is walked twice (it may run
//! more than once) and its effects joined with the state at its creation.
//!
//! Only containers take part, by the type compile.rs gave each expression and binding.

use super::*;
use std::collections::BTreeSet;

/// Calls whose result is a new value that holds nothing of the receiver.
const FRESH_METHODS: &[&str] = &[
    "map",
    "split",
    "keys",
    "toFixed",
    "toString",
    "join",
    "trim",
    "trimStart",
    "trimEnd",
    "toLowerCase",
    "toUpperCase",
    "padStart",
    "padEnd",
    "repeat",
    "replace",
    "replaceAll",
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
    "match",
    "matchAll",
    "test",
    "exec",
    "forEach",
];

/// Calls whose result is a new array holding the receiver's elements (they stay the receiver's).
const SHALLOW_METHODS: &[&str] = &[
    "filter",
    "slice",
    "concat",
    "flat",
    "flatMap",
    "toSorted",
    "toReversed",
    "with",
];

/// Calls whose result is one of the receiver's elements.
const ELEMENT_METHODS: &[&str] = &["find", "findLast", "at", "pop", "shift"];

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

/// Array methods that call their first argument with the receiver's elements: the element
/// parameter's index.
const CALLBACK_METHODS: &[(&str, usize)] = &[
    ("map", 0),
    ("forEach", 0),
    ("filter", 0),
    ("find", 0),
    ("findLast", 0),
    ("findIndex", 0),
    ("findLastIndex", 0),
    ("some", 0),
    ("every", 0),
    ("flatMap", 0),
    ("reduce", 1),
    ("reduceRight", 1),
    ("sort", 0),
    ("toSorted", 0),
];

/// What compile.rs learned: the type of each compiled expression and binding, and the
/// program-wide mutation effects.
pub(super) struct Oracle<'a> {
    pub types: &'a HashMap<Span, Ty>,
    pub bindings: &'a HashMap<Span, Ty>,
    pub effects: &'a effects::Effects,
}

fn container(t: &Ty) -> bool {
    match t {
        Ty::Union(ts) => ts.iter().any(container),
        Ty::Array(_) | Ty::Tuple(_) | Ty::ArrayLiteral(_) | Ty::Obj(_) | Ty::Map(_) | Ty::Unknown => true,
        Ty::Promise(t) => container(t),
        _ => false,
    }
}

pub(super) fn check(f: &Func, oracle: &Oracle<'_>) -> Result<()> {
    let mut w = Walk {
        oracle,
        st: State::default(),
        scopes: Vec::new(),
        next: 0,
        callback_of: None,
        closures: 0,
    };
    w.st.shared.insert(OUTSIDE);
    w.scopes.push(HashMap::new());
    for p in &f.params {
        let v = Val::outside();
        w.declare_pat(&p.pat, &v, true)?;
        if let Some(d) = &p.default {
            w.expr(d)?;
        }
    }
    match &f.body {
        FnBody::Expr(e) => w.expr(e),
        FnBody::Block(b) => w.stmts(b),
    }
}

type Bind = Span;
type Tag = usize;

/// Something beyond this function's locals: module values, a caller, an element of a value read
/// from anywhere unknown.
const OUTSIDE: Tag = 0;

#[derive(Clone, Default, PartialEq, Eq)]
struct State {
    of: HashMap<Bind, BTreeSet<Tag>>,
    shared: BTreeSet<Tag>,
    inner: HashMap<Tag, BTreeSet<Tag>>,
    params: HashSet<Bind>,
}

impl State {
    fn join(&mut self, o: &State) {
        for (b, ts) in &o.of {
            self.of.entry(*b).or_default().extend(ts);
        }
        self.shared.extend(&o.shared);
        for (t, i) in &o.inner {
            self.inner.entry(*t).or_default().extend(i);
        }
        self.params.extend(o.params.iter().copied());
    }

    /// Tags reachable below `ts` (their held containers, transitively).
    fn below(&self, ts: &BTreeSet<Tag>) -> BTreeSet<Tag> {
        let mut out = BTreeSet::new();
        let mut todo: Vec<Tag> = ts.iter().copied().collect();
        while let Some(t) = todo.pop() {
            for i in self.inner.get(&t).into_iter().flatten() {
                if out.insert(*i) {
                    todo.push(*i);
                }
            }
        }
        out
    }

    /// `ts` and everything below them are now held by someone else too.
    fn share(&mut self, ts: &BTreeSet<Tag>) {
        let all: BTreeSet<Tag> = ts.iter().copied().chain(self.below(ts)).collect();
        self.shared.extend(all);
    }
}

/// An expression's value, as tags: `tags` it may be, `inner` tags its members may be.
#[derive(Clone, Default)]
struct Val {
    tags: BTreeSet<Tag>,
    inner: BTreeSet<Tag>,
    /// A literal that holds containers built in place (no tag yet: only it holds them).
    holds_fresh: bool,
    scalar: bool,
}

impl Val {
    fn scalar() -> Self {
        Val {
            scalar: true,
            ..Default::default()
        }
    }
    fn outside() -> Self {
        Val {
            tags: BTreeSet::from([OUTSIDE]),
            ..Default::default()
        }
    }
    fn union(mut self, o: Val) -> Self {
        if o.scalar {
            return self;
        }
        if self.scalar {
            return o;
        }
        self.tags.extend(o.tags);
        self.inner.extend(o.inner);
        self.holds_fresh |= o.holds_fresh;
        self
    }
}

struct Walk<'o, 'a> {
    oracle: &'o Oracle<'a>,
    st: State,
    scopes: Vec<HashMap<String, Bind>>,
    next: Tag,
    /// Inside an inline callback of this array method.
    callback_of: Option<String>,
    /// How many closures deep the walk is.
    closures: usize,
}

impl Walk<'_, '_> {
    fn fresh(&mut self) -> Tag {
        self.next += 1;
        self.next
    }

    fn lookup(&self, name: &str) -> Option<Bind> {
        self.scopes.iter().rev().find_map(|s| s.get(name).copied())
    }

    fn tags(&self, b: Bind) -> BTreeSet<Tag> {
        self.st.of.get(&b).cloned().unwrap_or_default()
    }

    fn is_container(&self, e: &Expr) -> bool {
        self.oracle.types.get(&e.span).is_none_or(container)
    }

    // ---- values ----------------------------------------------------------------------------

    /// A member read of `v`: one of the containers `v` holds.
    fn member(&self, v: &Val) -> Val {
        if v.scalar {
            return Val::outside();
        }
        let mut tags: BTreeSet<Tag> = v.inner.clone();
        // A local's members are what was built or stored into it (`store` records each); a
        // container someone else may also reach can hold anything.
        tags.extend(self.st.below(&v.tags));
        if v.tags.iter().any(|t| self.st.shared.contains(t)) {
            tags.insert(OUTSIDE);
        }
        Val {
            tags,
            ..Default::default()
        }
    }

    /// A shallow copy of `v`: a new container whose members are `v`'s members.
    fn shallow(&self, v: &Val) -> Val {
        if v.scalar {
            return Val::default();
        }
        Val {
            inner: self.member(v).tags,
            ..Default::default()
        }
    }

    fn val(&self, e: &Expr) -> Val {
        if !self.is_container(e) {
            return Val::scalar();
        }
        match &e.kind {
            ExprKind::Num(_)
            | ExprKind::Str(_)
            | ExprKind::Bool(_)
            | ExprKind::Null
            | ExprKind::Undefined
            | ExprKind::Template(..)
            | ExprKind::Binary(..)
            | ExprKind::Unary(..)
            | ExprKind::IsNullish(..)
            | ExprKind::Update { .. }
            | ExprKind::Func(_)
            | ExprKind::Regex { .. } => Val::scalar(),
            ExprKind::Array(items) => {
                let mut v = Val::default();
                for it in items {
                    match it {
                        ArrEl::Item(x) => {
                            let x = self.val(x);
                            if !x.scalar {
                                v.holds_fresh |= x.tags.is_empty();
                                v.inner.extend(x.tags);
                            }
                        }
                        ArrEl::Spread(x) => v.inner.extend(self.shallow(&self.val(x)).inner),
                    }
                }
                v
            }
            ExprKind::Object(props) => {
                let mut v = Val::default();
                for p in props {
                    match p {
                        Prop::KV(_, x) => {
                            let x = self.val(x);
                            if !x.scalar {
                                v.holds_fresh |= x.tags.is_empty();
                                v.inner.extend(x.tags);
                            }
                        }
                        Prop::Spread(x) => v.inner.extend(self.shallow(&self.val(x)).inner),
                    }
                }
                v
            }
            ExprKind::New { .. } => Val::default(),
            ExprKind::Ident(n) => match self.lookup(n) {
                Some(b) => Val {
                    tags: self.tags(b),
                    ..Default::default()
                },
                None => Val::outside(),
            },
            ExprKind::Member { obj, .. } | ExprKind::Index { obj, .. } => self.member(&self.val(obj)),
            ExprKind::NonNull(x) | ExprKind::As(x, _) | ExprKind::Chain(x) | ExprKind::Await(x) => self.val(x),
            ExprKind::Cond(_, a, b) | ExprKind::Logical(_, a, b) => self.val(a).union(self.val(b)),
            ExprKind::Assign { target, value, op } => match op {
                None => self.val(value),
                Some(_) => self.val(target).union(self.val(value)),
            },
            ExprKind::Call { callee, args, .. } => self.call_val(e, callee, args),
        }
    }

    fn args_val(&self, args: &[ArrEl]) -> Val {
        args.iter().fold(Val::scalar(), |v, a| {
            let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
            v.union(self.val(x))
        })
    }

    fn call_val(&self, call: &Expr, callee: &Expr, args: &[ArrEl]) -> Val {
        let fx = self.oracle.effects;
        if fx.resolved(call.span) {
            if !fx.result_shared(call.span) {
                return Val::default();
            }
            let mut v = Val::outside();
            for (i, a) in args.iter().enumerate() {
                let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
                if fx.argument_retained(call.span, i) {
                    v = v.union(self.val(x));
                    v = v.union(self.member(&self.val(x)));
                }
            }
            return v;
        }
        let ExprKind::Member { obj, prop, .. } = &callee.kind else {
            return Val::outside();
        };
        if is_db_chain(obj) {
            return Val::default();
        }
        if let ExprKind::Ident(g) = &obj.kind
            && self.lookup(g).is_none()
        {
            return match (g.as_str(), prop.as_str()) {
                ("Object", "assign") => self.args_val(args),
                ("Object", "values" | "entries" | "fromEntries") | ("Array", "from" | "of") => {
                    let a = self.args_val(args);
                    if prop == "of" {
                        Val {
                            inner: a.tags,
                            ..Default::default()
                        }
                    } else {
                        self.shallow(&a)
                    }
                }
                ("JSON" | "Math" | "Number" | "String" | "Object" | "Array" | "Date" | "Boolean", _) => Val::default(),
                _ => Val::outside(),
            };
        }
        let recv = self.val(obj);
        let p = prop.as_str();
        if SHALLOW_METHODS.contains(&p) {
            let mut v = self.shallow(&recv);
            if p == "concat" {
                for a in args {
                    let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
                    let x = self.val(x);
                    v.inner.extend(self.shallow(&x).inner);
                    v.inner.extend(x.tags);
                }
            }
            return v;
        }
        if ELEMENT_METHODS.contains(&p) {
            return self.member(&recv);
        }
        if p == "reduce" || p == "reduceRight" {
            // The accumulator: the initial value, an element, or whatever the callback returns.
            let init = args.get(1).map_or(Val::scalar(), |a| {
                let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
                self.val(x)
            });
            return init.union(self.member(&recv)).union(Val::outside());
        }
        if matches!(p, "sort" | "reverse" | "fill" | "copyWithin") {
            return recv;
        }
        if FRESH_METHODS.contains(&p) || MUTATORS.contains(&p) {
            return Val::default();
        }
        Val::outside()
    }

    // ---- bindings --------------------------------------------------------------------------

    fn bind(&mut self, b: Bind, v: &Val) {
        if v.scalar || !self.oracle.bindings.get(&b).is_none_or(container) {
            self.st.of.remove(&b);
            return;
        }
        // Members of a shallow copy are held by the copy and its source; a literal's members
        // that came from locals were shared when the literal was built.
        self.st.share(&v.inner);
        let mut tags = v.tags.clone();
        if tags.is_empty() {
            let t = self.fresh();
            let mut inner = v.inner.clone();
            if v.holds_fresh {
                // The containers built inside the literal: only this local holds them, for now.
                let held = self.fresh();
                inner.insert(held);
            }
            if !inner.is_empty() {
                self.st.inner.insert(t, inner);
            }
            tags.insert(t);
        } else {
            // A second holder of the same container(s).
            self.st.share(&tags);
            for t in &tags {
                if !v.inner.is_empty() {
                    self.st.inner.entry(*t).or_default().extend(v.inner.iter().copied());
                }
            }
        }
        self.st.of.insert(b, tags);
    }

    fn declare_name(&mut self, n: &str, span: Span, param: bool) {
        self.scopes.last_mut().expect("scope").insert(n.to_string(), span);
        if param {
            self.st.params.insert(span);
        } else {
            self.st.params.remove(&span);
        }
    }

    fn declare_pat(&mut self, pat: &Pat, v: &Val, param: bool) -> Result<()> {
        match pat {
            Pat::Id(n, span) => {
                self.declare_name(n, *span, param);
                self.bind(*span, v);
            }
            Pat::Default(p, d) => {
                self.expr(d)?;
                let dv = self.val(d);
                self.declare_pat(p, &v.clone().union(dv), param)?;
            }
            Pat::Obj { props, rest, .. } => {
                let m = self.member(v);
                for (_, p) in props {
                    self.declare_pat(p, &m, param)?;
                }
                if let Some((n, span)) = rest {
                    self.declare_name(n, *span, param);
                    let s = self.shallow(v);
                    self.bind(*span, &s);
                }
            }
            Pat::Arr { elems, rest, .. } => {
                let m = self.member(v);
                for p in elems.iter().flatten() {
                    self.declare_pat(p, &m, param)?;
                }
                if let Some((n, span)) = rest {
                    self.declare_name(n, *span, param);
                    let s = self.shallow(v);
                    self.bind(*span, &s);
                }
            }
        }
        Ok(())
    }

    /// The value is now also held by something the walk can't follow.
    fn escape(&mut self, v: &Val) {
        if v.scalar {
            return;
        }
        let all: BTreeSet<Tag> = v.tags.iter().chain(&v.inner).copied().collect();
        self.st.share(&all);
    }

    /// `v` is now held inside the container(s) of `holder`.
    fn store(&mut self, holder: &Expr, v: &Val) {
        if v.scalar {
            return;
        }
        let held: BTreeSet<Tag> = v.tags.iter().chain(&v.inner).copied().collect();
        // Held by its old holders and now also by this one.
        self.st.share(&v.tags);
        let h = self.val(holder);
        let mut holders: BTreeSet<Tag> = h.tags.clone();
        holders.extend(h.inner.iter().copied());
        if holders.is_empty() || holders.contains(&OUTSIDE) {
            self.escape(v);
        }
        for t in holders {
            self.st.inner.entry(t).or_default().extend(held.iter().copied());
            if self.st.shared.contains(&t) {
                self.st.share(&held);
            }
        }
    }

    // ---- writes ----------------------------------------------------------------------------

    /// A write `depth` member steps below the local `b` (1 = into `b` itself).
    fn write(&self, name: &str, b: Bind, depth: usize, span: Span) -> Result<()> {
        let tags = self.tags(b);
        if depth == 1 && !self.st.params.contains(&b) && tags.iter().any(|t| self.st.shared.contains(t)) {
            return self.reject(name, span);
        }
        if depth >= 2 {
            let below = self.st.below(&tags);
            let into_param = self.st.params.contains(&b);
            if below.iter().any(|t| self.st.shared.contains(t))
                || (!into_param && tags.iter().any(|t| self.st.shared.contains(t)))
            {
                return self.reject(name, span);
            }
        }
        Ok(())
    }

    fn reject(&self, name: &str, span: Span) -> Result<()> {
        if let Some(method) = &self.callback_of {
            return err_help(
                span,
                format!(
                    "`{method}` passes each element to the callback as a copy in compiled PHP, so this change would be lost"
                ),
                "use `for (const item of list) { item.x = ... }`, which changes the elements themselves",
            );
        }
        err_help(
            span,
            format!(
                "`{name}` may be the same object or array as another value here, and compiled PHP copies it: this change wouldn't show up there"
            ),
            "change the original directly (for example `list[i].x = ...` instead of through a copy), or make an explicit copy first and use it from then on (`const b = { ...a }` / `[...a]`) — note a spread copy only copies the top level",
        )
    }

    /// The local an interior write goes into and how many member steps below it.
    fn root(target: &Expr) -> Option<(&str, usize)> {
        match &target.kind {
            ExprKind::Ident(n) => Some((n, 0)),
            ExprKind::Member { obj, .. } | ExprKind::Index { obj, .. } => Self::root(obj).map(|(n, d)| (n, d + 1)),
            ExprKind::NonNull(x) | ExprKind::As(x, _) | ExprKind::Chain(x) => Self::root(x),
            _ => None,
        }
    }

    /// A write `extra` steps below `target` (0 for `target = v` where target is a member place,
    /// 1 for `target.push(v)`).
    fn write_through(&self, target: &Expr, extra: usize, span: Span) -> Result<()> {
        match Self::root(target) {
            Some((name, depth)) if depth + extra >= 1 => match self.lookup(name) {
                Some(b) => self.write(name, b, depth + extra, span),
                // A module value or a global: compiled code holds a copy.
                None => self.reject(name, span),
            },
            Some(_) => Ok(()),
            // `f().x = 1`, `[a][0].x = 1`: into a temporary, so into whatever it holds.
            None => {
                let v = self.val(target);
                if v.tags.iter().any(|t| self.st.shared.contains(t)) {
                    return self.reject("this value", span);
                }
                Ok(())
            }
        }
    }

    // ---- statements ------------------------------------------------------------------------

    fn stmts(&mut self, stmts: &[Stmt]) -> Result<()> {
        self.scopes.push(HashMap::new());
        let r = stmts.iter().try_for_each(|s| self.stmt(s));
        self.scopes.pop();
        r
    }

    /// Run `body` until the joined state stops changing (zero or more iterations).
    fn looped(&mut self, mut body: impl FnMut(&mut Self) -> Result<()>) -> Result<()> {
        let mut acc = self.st.clone();
        for _ in 0..16 {
            body(self)?;
            let mut next = acc.clone();
            next.join(&self.st);
            if next == acc {
                break;
            }
            acc = next;
            self.st = acc.clone();
        }
        self.st = acc;
        Ok(())
    }

    fn branch(
        &mut self,
        a: impl FnOnce(&mut Self) -> Result<()>,
        b: impl FnOnce(&mut Self) -> Result<()>,
    ) -> Result<()> {
        let entry = self.st.clone();
        a(self)?;
        let after_a = std::mem::replace(&mut self.st, entry);
        b(self)?;
        self.st.join(&after_a);
        Ok(())
    }

    fn stmt(&mut self, s: &Stmt) -> Result<()> {
        match s {
            Stmt::Decl { pat, init, .. } => {
                let v = match init {
                    Some(e) => {
                        self.expr(e)?;
                        self.val(e)
                    }
                    None => Val::scalar(),
                };
                self.declare_pat(pat, &v, false)?;
            }
            Stmt::Expr(e) => self.expr(e)?,
            Stmt::Throw(e) | Stmt::ExportDefault(e) => {
                self.expr(e)?;
                let v = self.val(e);
                self.escape(&v);
            }
            Stmt::Return(Some(e), _) => {
                self.expr(e)?;
                if self.closures > 0 {
                    // Returned from a closure: its caller in this function now holds it too.
                    let v = self.val(e);
                    self.escape(&v);
                }
            }
            Stmt::If(t, a, b) => {
                self.expr(t)?;
                self.branch(|w| w.stmts(a), |w| b.as_ref().map_or(Ok(()), |b| w.stmts(b)))?;
            }
            Stmt::Block(b) => self.stmts(b)?,
            Stmt::While(t, b) => {
                self.expr(t)?;
                self.looped(|w| {
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
                self.scopes.push(HashMap::new());
                let r = (|| {
                    if let Some(i) = init {
                        self.stmt(i)?;
                    }
                    if let Some(t) = test {
                        self.expr(t)?;
                    }
                    self.looped(|w| {
                        w.stmts(body)?;
                        if let Some(u) = update {
                            w.expr(u)?;
                        }
                        if let Some(t) = test {
                            w.expr(t)?;
                        }
                        Ok(())
                    })
                })();
                self.scopes.pop();
                r?;
            }
            Stmt::ForOf { pat, iter, body, .. } => {
                self.expr(iter)?;
                let src = self.val(iter);
                // compile.rs loops over a plain local by reference when the body writes its
                // element, so those writes land in the array itself.
                let local = matches!(&iter.kind, ExprKind::Ident(n) if self.lookup(n).is_some());
                self.scopes.push(HashMap::new());
                let r = self.looped(|w| {
                    let el = w.member(&src);
                    match pat {
                        Pat::Id(n, span) if local => {
                            // The element itself, through a reference: a write into it is a write
                            // into the array, which is only safe if the array isn't shared.
                            w.declare_name(n, *span, false);
                            let sharing = src.tags.iter().any(|t| w.st.shared.contains(t));
                            let v = if sharing { el } else { Val::default() };
                            let tags_inner: BTreeSet<Tag> = w.st.below(&src.tags);
                            w.bind(*span, &v);
                            // Its members are the array's members' members.
                            if !sharing && let Some(ts) = w.st.of.get(span).cloned() {
                                for t in ts {
                                    let below = w.st.below(&tags_inner);
                                    w.st.inner.entry(t).or_default().extend(below.iter().copied());
                                }
                            }
                        }
                        _ => w.declare_pat(pat, &el, false)?,
                    }
                    w.stmts(body)
                });
                self.scopes.pop();
                r?;
            }
            Stmt::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                let entry = self.st.clone();
                self.stmts(block)?;
                // The handler may start anywhere in the block.
                self.st.join(&entry);
                if let Some(h) = handler {
                    self.scopes.push(HashMap::new());
                    if let Some((n, span)) = param {
                        self.declare_name(n, *span, false);
                        self.bind(*span, &Val::outside());
                    }
                    let r = self.stmts(h);
                    self.scopes.pop();
                    r?;
                }
                if let Some(f) = finalizer {
                    self.stmts(f)?;
                }
            }
            Stmt::Switch { disc, cases, .. } => {
                self.expr(disc)?;
                let entry = self.st.clone();
                let mut out = entry.clone();
                let mut running = entry.clone();
                for (t, b) in cases {
                    // A case starts from the entry, or falls through from the previous one.
                    self.st = running.clone();
                    self.st.join(&entry);
                    if let Some(t) = t {
                        self.expr(t)?;
                    }
                    self.stmts(b)?;
                    out.join(&self.st);
                    running = self.st.clone();
                }
                self.st = out;
            }
            Stmt::Exported(s) => self.stmt(s)?,
            Stmt::Func(f) => {
                if let Some(n) = &f.name {
                    self.declare_name(n, f.span, false);
                }
                self.closure(f)?;
            }
            Stmt::Return(None, _)
            | Stmt::Break(_)
            | Stmt::Continue(_)
            | Stmt::TypeAlias { .. }
            | Stmt::Import { .. }
            | Stmt::ExportNames { .. }
            | Stmt::ExportAll { .. } => {}
        }
        Ok(())
    }

    /// A closure created here. It may run later, any number of times, so it is walked twice on
    /// the current state and its effects joined in.
    fn closure(&mut self, f: &Func) -> Result<()> {
        let saved_cb = self.callback_of.take();
        let entry = self.st.clone();
        self.closures += 1;
        let r = (|| {
            for _ in 0..2 {
                self.scopes.push(HashMap::new());
                for p in &f.params {
                    self.declare_pat(&p.pat, &Val::outside(), true)?;
                    if let Some(d) = &p.default {
                        self.expr(d)?;
                    }
                }
                let body = match &f.body {
                    FnBody::Expr(e) => self.expr(e).map(|_| {
                        let v = self.val(e);
                        self.escape(&v);
                    }),
                    FnBody::Block(b) => self.stmts(b),
                };
                self.scopes.pop();
                body?;
            }
            Ok(())
        })();
        self.closures -= 1;
        self.callback_of = saved_cb;
        r?;
        // A captured local is the same PHP variable in the closure (compile.rs captures it by
        // reference whenever anything writes it), so capturing alone doesn't copy it.
        self.st.join(&entry);
        Ok(())
    }

    /// An inline callback of an array method: its element parameter is a copy in PHP.
    fn inline_callback(&mut self, f: &Func, method: &str, el_index: usize, recv: &Val) -> Result<()> {
        // Elements of a receiver nobody else holds (a literal, a map result): changing them is
        // invisible either way, so the callback walks like any closure.
        let fresh = recv.tags.is_empty() && recv.inner.iter().all(|t| !self.st.shared.contains(t));
        if fresh {
            return self.closure(f);
        }
        let saved = self.callback_of.replace(method.to_string());
        let entry = self.st.clone();
        self.closures += 1;
        let r = (|| {
            for _ in 0..2 {
                self.scopes.push(HashMap::new());
                for (i, p) in f.params.iter().enumerate() {
                    let v = if i == el_index || (el_index == 1 && i == 0) {
                        Val::outside()
                    } else {
                        Val::scalar()
                    };
                    self.declare_pat(&p.pat, &v, false)?;
                }
                let body = match &f.body {
                    FnBody::Expr(e) => self.expr(e),
                    FnBody::Block(b) => self.stmts(b),
                };
                self.scopes.pop();
                body?;
            }
            Ok(())
        })();
        self.closures -= 1;
        self.callback_of = saved;
        r?;
        self.st.join(&entry);
        Ok(())
    }

    // ---- expressions -----------------------------------------------------------------------

    fn expr(&mut self, e: &Expr) -> Result<()> {
        match &e.kind {
            ExprKind::Assign { target, value, op } => {
                self.expr(value)?;
                self.sub_exprs(target)?;
                let v = self.val(value);
                if let ExprKind::Ident(n) = &target.kind {
                    if let Some(b) = self.lookup(n) {
                        if self.closures > 0 && !self.scopes.last().is_some_and(|s| s.contains_key(n)) {
                            // A closure rebinding a captured local: the closure holds the value.
                            self.escape(&v);
                        }
                        let v = match op {
                            None => v,
                            // `a ??= b` / `a ||= b`: either the old value or the new one.
                            Some(_) => v.union(Val {
                                tags: self.tags(b),
                                ..Default::default()
                            }),
                        };
                        self.bind(b, &v);
                    }
                } else {
                    self.write_through(target, 0, e.span)?;
                    if let ExprKind::Member { obj, .. } | ExprKind::Index { obj, .. } = &target.kind {
                        self.store(obj, &v);
                    }
                }
            }
            ExprKind::Update { target, .. } => {
                self.sub_exprs(target)?;
                self.write_through(target, 0, e.span)?;
            }
            ExprKind::Call { callee, args, .. } => self.call(e, callee, args)?,
            ExprKind::Array(items) => {
                for it in items {
                    let (ArrEl::Item(x) | ArrEl::Spread(x)) = it;
                    self.expr(x)?;
                    let v = self.val(x);
                    // Placed in a new container: held by it too.
                    if matches!(it, ArrEl::Item(_)) {
                        self.st.share(&v.tags);
                    }
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
                            let v = self.val(x);
                            self.st.share(&v.tags);
                        }
                        Prop::Spread(x) => self.expr(x)?,
                    }
                }
            }
            ExprKind::Binary(_, a, b) => {
                self.expr(a)?;
                self.expr(b)?;
            }
            ExprKind::Logical(_, a, b) => {
                self.expr(a)?;
                self.branch(|w| w.expr(b), |_| Ok(()))?;
            }
            ExprKind::Cond(a, b, c) => {
                self.expr(a)?;
                self.branch(|w| w.expr(b), |w| w.expr(c))?;
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
                    let v = self.val(x);
                    self.escape(&v);
                }
            }
            ExprKind::Func(f) => self.closure(f)?,
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

    fn call(&mut self, e: &Expr, callee: &Expr, args: &[ArrEl]) -> Result<()> {
        self.expr(callee)?;
        let fx = self.oracle.effects;
        let resolved = fx.resolved(e.span);
        let method = match &callee.kind {
            ExprKind::Member { obj, prop, .. } if !resolved => Some((&**obj, prop.as_str())),
            _ => None,
        };
        let callback = method.and_then(|(obj, m)| {
            CALLBACK_METHODS
                .iter()
                .find(|(n, _)| *n == m)
                .filter(|_| self.lookup_global(obj).is_none())
                .map(|(_, i)| (obj, m, *i))
        });
        for (i, a) in args.iter().enumerate() {
            let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
            match (i, callback, &x.kind) {
                (0, Some((obj, m, el)), ExprKind::Func(f)) => {
                    let recv = self.val(obj);
                    self.inline_callback(f, m, el, &recv)?;
                }
                (0, Some((obj, m, el)), _) => {
                    self.expr(x)?;
                    let recv = self.val(obj);
                    let fresh = recv.tags.is_empty() && recv.inner.iter().all(|t| !self.st.shared.contains(t));
                    if !fresh && fx.callback_write_depth(e.span, el).is_some() {
                        return err_help(
                            x.span,
                            format!(
                                "`{m}` passes each element to this function as a copy in compiled PHP, so its changes would be lost"
                            ),
                            "use `for (const item of list) { ... }` and change `item` there",
                        );
                    }
                }
                _ => self.expr(x)?,
            }
        }
        if let Some((obj, m)) = method {
            if let Some(g) = self.lookup_global(obj) {
                if (g, m) == ("Object", "assign")
                    && let Some(ArrEl::Item(target)) = args.first()
                {
                    self.write_through(target, 1, e.span)?;
                    for a in &args[1..] {
                        let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
                        let v = self.member(&self.val(x));
                        self.store(target, &v);
                    }
                }
                return Ok(());
            }
            if is_db_chain(obj) {
                for a in args {
                    let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
                    let _ = x;
                }
                return Ok(());
            }
            if MUTATORS.contains(&m) {
                self.write_through(obj, 1, e.span)?;
                if matches!(m, "push" | "unshift" | "splice" | "fill") {
                    let from = if m == "splice" { 2 } else { 0 };
                    for a in args.iter().skip(from) {
                        let v = match a {
                            ArrEl::Item(x) => self.val(x),
                            ArrEl::Spread(x) => self.member(&self.val(x)),
                        };
                        self.store(obj, &v);
                    }
                }
            }
            return Ok(());
        }
        if resolved {
            for (i, a) in args.iter().enumerate() {
                let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
                if let Some(depth) = fx.argument_write_depth(e.span, i) {
                    match Self::root(x) {
                        // By reference (compile.rs passes the place `a` / `a.b[i]`): the callee
                        // writes `depth` steps below it.
                        Some((name, d)) => match self.lookup(name) {
                            Some(b) => {
                                self.write(name, b, d + depth, x.span)?;
                                if fx.stores_into_argument(e.span, i) {
                                    // It may store anything there.
                                    for t in self.tags(b) {
                                        self.st.inner.entry(t).or_default().insert(OUTSIDE);
                                    }
                                }
                            }
                            None => return self.reject(name, x.span),
                        },
                        None => {
                            let v = self.val(x);
                            if !(v.tags.is_empty() && v.inner.iter().all(|t| !self.st.shared.contains(t))) {
                                return self.reject("this argument", x.span);
                            }
                        }
                    }
                }
                // Kept by the callee: stored somewhere, or returned as (part of) a container.
                if fx.argument_stored(e.span, i) || (fx.argument_retained(e.span, i) && self.is_container(e)) {
                    let v = self.val(x);
                    self.escape(&v);
                } else if fx.argument_member_stored(e.span, i) {
                    // A member of it is kept: whatever it holds is shared from here on.
                    let v = self.val(x);
                    let m = self.member(&v);
                    self.escape(&m);
                }
            }
        }
        Ok(())
    }

    /// `Object`/`Array`/`JSON`/...: a builtin namespace, not a local.
    fn lookup_global<'e>(&self, obj: &'e Expr) -> Option<&'e str> {
        match &obj.kind {
            ExprKind::Ident(g) if self.lookup(g).is_none() && GLOBALS.contains(&g.as_str()) => Some(g),
            _ => None,
        }
    }

    /// Index expressions inside a write target still run (`a[i++] = 1`).
    fn sub_exprs(&mut self, target: &Expr) -> Result<()> {
        match &target.kind {
            ExprKind::Member { obj, .. } => self.sub_exprs(obj),
            ExprKind::Index { obj, index, .. } => {
                self.sub_exprs(obj)?;
                self.expr(index)
            }
            ExprKind::NonNull(x) | ExprKind::As(x, _) | ExprKind::Chain(x) => self.sub_exprs(x),
            ExprKind::Ident(_) => Ok(()),
            _ => self.expr(target),
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
