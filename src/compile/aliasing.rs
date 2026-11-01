//! Reject-first sharing check. JavaScript shares objects and arrays by reference; compiled PHP
//! copies arrays on assignment, on return and when passing by value. Changing a container that
//! another live value also holds would show up in JS and silently not in PHP, so it is a build
//! error with a located fix.
//!
//! The check is flow-insensitive over one compiled function, its nested closures included (they
//! share its bindings): if two values may be the same container anywhere in the function, they
//! are treated as the same container everywhere. That over-refuses a little (an alias made after
//! a write still refuses the write) and in exchange holds across branches, loops, `try`/`catch`,
//! `break`/`continue`, and closures called at any time.
//!
//! Containers form classes (union-find). A class has one *interior* class standing for every
//! container held inside it, at any depth. A literal's items, a stored value and a pushed value
//! join the holder's interior; a member or element read is the interior; a shallow copy
//! (`{ ...a }`, `a.slice()`) is a new class sharing `a`'s interior. A class is *outside* when
//! something beyond this function's locals may hold it (a module value, an argument a callee
//! keeps, a value of unknown origin).
//!
//! A write into a binding (`b.k = v`, `b[i] = v`, `b.k++`, `b.push(v)`, a callee that writes its
//! parameter `b`) is refused when its class has another binding, is outside, or is the interior
//! of something observable. A write below its top level (`b.k.j = v`, `b.k.push(v)`) is also
//! refused when its interior can be seen from anywhere but `b`. A parameter's caller doesn't
//! count: compile.rs passes a mutated parameter by reference, and the call site checks the place
//! it passes.

use super::*;

/// Calls whose result is a new value that holds nothing of the receiver.
const FRESH_METHODS: &[&str] = &[
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
    "push",
    "unshift",
];

/// Calls whose result is a new array holding the receiver's elements (they stay the receiver's).
const SHALLOW_METHODS: &[&str] = &[
    "filter",
    "slice",
    "concat",
    "flat",
    "toSorted",
    "toReversed",
    "with",
    "splice",
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

pub(super) fn container(t: &Ty) -> bool {
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
        uf: Uf::default(),
        scopes: vec![HashMap::new()],
        classes: HashMap::new(),
        closures: HashMap::new(),
        returns: Vec::new(),
        callback_params: HashMap::new(),
        copies: HashMap::new(),
        last_callback: Vec::new(),
        callback_route: HashMap::new(),
        writes: Vec::new(),
    };
    w.params(&f.params);
    w.body(&f.body);
    w.verify()
}

type Class = usize;

/// Union-find over containers.
#[derive(Default)]
struct Uf {
    parent: Vec<Class>,
    outside: Vec<bool>,
    /// The class stands for the containers held inside its holders (an interior).
    is_interior: Vec<bool>,
    interior: Vec<Option<Class>>,
    /// For an interior: the classes whose interior it is.
    holders: Vec<Vec<Class>>,
    bindings: Vec<Vec<Span>>,
    /// Containers this class's container was stored into.
    held_in: Vec<Vec<Class>>,
    /// For an interior: the containers stored into its holders.
    contents: Vec<Vec<Class>>,
    /// A parameter's container: it may hold anything its caller put in it.
    opaque: Vec<bool>,
    /// The containers of this class may sit in more than one place (stored again inside a holder
    /// that already reaches them, `o.right = o.left`).
    repeated: Vec<bool>,
    /// A callee's hold on an argument it keeps: the call that made it.
    keepers: Vec<Option<Span>>,
}

impl Uf {
    fn new_class(&mut self) -> Class {
        let c = self.parent.len();
        self.parent.push(c);
        self.outside.push(false);
        self.is_interior.push(false);
        self.interior.push(None);
        self.holders.push(Vec::new());
        self.bindings.push(Vec::new());
        self.held_in.push(Vec::new());
        self.contents.push(Vec::new());
        self.opaque.push(false);
        self.repeated.push(false);
        self.keepers.push(None);
        c
    }

    fn outside_class(&mut self) -> Class {
        let c = self.new_class();
        self.outside[c] = true;
        c
    }

    fn find(&mut self, mut c: Class) -> Class {
        while self.parent[c] != c {
            self.parent[c] = self.parent[self.parent[c]];
            c = self.parent[c];
        }
        c
    }

    /// The class of everything held inside `c` (an interior is its own interior).
    fn interior(&mut self, c: Class) -> Class {
        let c = self.find(c);
        if self.is_interior[c] {
            return c;
        }
        if let Some(i) = self.interior[c] {
            return self.find(i);
        }
        let i = self.new_class();
        self.is_interior[i] = true;
        self.holders[i].push(c);
        // Members of something outside are outside too.
        self.outside[i] = self.outside[c];
        self.interior[c] = Some(i);
        i
    }

    /// Whether `c` may hold a container: something was stored in it, it's outside, or it's an
    /// interior (whose members are its own).
    fn holds_anything(&mut self, c: Class) -> bool {
        let c = self.find(c);
        if self.outside[c] || self.is_interior[c] || self.opaque[c] {
            return true;
        }
        match self.interior[c] {
            Some(i) => {
                let i = self.find(i);
                self.outside[i]
                    || !self.contents[i].is_empty()
                    || !self.bindings[i].is_empty()
                    || !self.held_in[i].is_empty()
            }
            None => false,
        }
    }

    fn existing_interior(&mut self, c: Class) -> Option<Class> {
        let c = self.find(c);
        if self.is_interior[c] {
            return Some(c);
        }
        self.interior[c].map(|i| self.find(i))
    }

    fn unite(&mut self, a: Class, b: Class) {
        let a = self.find(a);
        let b = self.find(b);
        if a == b {
            return;
        }
        self.parent[b] = a;
        self.outside[a] |= self.outside[b];
        self.opaque[a] |= self.opaque[b];
        self.repeated[a] |= self.repeated[b];
        let hb = std::mem::take(&mut self.holders[b]);
        self.holders[a].extend(hb);
        let bb = std::mem::take(&mut self.bindings[b]);
        self.bindings[a].extend(bb);
        let hb = std::mem::take(&mut self.held_in[b]);
        self.held_in[a].extend(hb);
        let cb = std::mem::take(&mut self.contents[b]);
        self.contents[a].extend(cb);
        let ia = self.interior[a].take();
        let ib = self.interior[b].take();
        if self.is_interior[a] || self.is_interior[b] {
            // An interior is its own interior: whatever was held inside either side joins it.
            self.is_interior[a] = true;
            for i in [ia, ib].into_iter().flatten() {
                self.unite(a, i);
            }
        } else {
            match (ia, ib) {
                (Some(x), Some(y)) => {
                    self.interior[a] = Some(x);
                    self.unite(x, y);
                }
                (x, y) => self.interior[a] = x.or(y),
            }
        }
        // Outside propagates to what an outside container holds.
        let a = self.find(a);
        if self.outside[a]
            && let Some(i) = self.interior[a]
        {
            let i = self.find(i);
            if !self.outside[i] {
                self.mark_outside(i);
            }
        }
    }

    fn mark_outside(&mut self, c: Class) {
        let mut c = self.find(c);
        loop {
            self.outside[c] = true;
            match self.interior[c] {
                Some(i) => {
                    let i = self.find(i);
                    if i == c || self.outside[i] {
                        return;
                    }
                    c = i;
                }
                None => return,
            }
        }
    }

    /// Store `v` inside `holder`: `v` is held by it, and reading a member of `holder` may give `v`.
    fn store(&mut self, holder: Class, v: Class) {
        let h = self.find(holder);
        let i = self.interior(h);
        let v = self.find(v);
        if v == i || v == h {
            // Stored again where it already is (`o.right = o.left`): two places, one container.
            self.repeated[v] = true;
            return;
        }
        self.held_in[v].push(h);
        self.contents[i].push(v);
        if self.outside[h] {
            self.mark_outside(v);
        }
    }

    /// Whether two values may share a container: the same class, or one held (at any depth)
    /// inside the other.
    fn overlap(&mut self, a: Class, b: Class) -> bool {
        let a = self.find(a);
        let b = self.find(b);
        a == b || self.reaches(a, b) || self.reaches(b, a)
    }

    /// Whether `inner` is held somewhere below `outer`.
    fn reaches(&mut self, outer: Class, inner: Class) -> bool {
        let mut seen = HashSet::new();
        let mut todo = vec![outer];
        while let Some(c) = todo.pop() {
            let c = self.find(c);
            if !seen.insert(c) {
                continue;
            }
            if let Some(i) = self.interior[c] {
                let i = self.find(i);
                if i == inner {
                    return true;
                }
                todo.push(i);
                todo.extend(self.contents[i].clone());
            }
            if self.is_interior[c] {
                for k in self.contents[c].clone() {
                    if self.find(k) == inner {
                        return true;
                    }
                    todo.push(k);
                }
            }
        }
        false
    }

    /// Whether anything can still see this class's container after the expression that made it:
    /// a binding, the outside, or an observable container holding it.
    fn observable(&mut self, c: Class, seen: &mut HashSet<Class>) -> bool {
        let c = self.find(c);
        if !seen.insert(c) {
            return false;
        }
        if !self.bindings[c].is_empty() || self.outside[c] || self.keepers[c].is_some() {
            return true;
        }
        let mut via: Vec<Class> = self.held_in[c].clone();
        if self.is_interior[c] {
            via.extend(self.holders[c].iter().copied());
        }
        via.into_iter().any(|h| self.observable(h, seen))
    }

    /// Whether something other than `binding`, reached other than through `route` (the holder
    /// a write goes through), can see the container(s) of class `c`.
    fn seen_elsewhere(&mut self, c: Class, binding: Option<Span>, route: Option<Class>) -> bool {
        self.seen_elsewhere_in(c, binding, route, &mut HashSet::new())
    }

    /// As `seen_elsewhere`, ignoring what the call `call` keeps (its own writes reach that).
    fn seen_elsewhere_but(&mut self, c: Class, binding: Option<Span>, call: Span) -> bool {
        let hidden: Vec<Class> = (0..self.keepers.len())
            .filter(|k| self.keepers[*k] == Some(call))
            .collect();
        for k in &hidden {
            self.keepers[*k] = None;
        }
        let mut seen: HashSet<Class> = hidden.iter().map(|k| self.find(*k)).collect();
        let r = self.seen_elsewhere_in(c, binding, None, &mut seen);
        for k in hidden {
            self.keepers[k] = Some(call);
        }
        r
    }

    fn seen_elsewhere_in(
        &mut self,
        c: Class,
        binding: Option<Span>,
        route: Option<Class>,
        seen: &mut HashSet<Class>,
    ) -> bool {
        let c = self.find(c);
        if !seen.insert(c) {
            return false;
        }
        if self.outside[c] || self.repeated[c] || self.bindings[c].iter().any(|b| Some(*b) != binding) {
            return true;
        }
        let route = route.map(|r| self.find(r));
        let held_in = self.held_in[c].clone();
        for h in held_in {
            let h = self.find(h);
            if Some(h) != route && !seen.contains(&h) && self.observable(h, &mut HashSet::new()) {
                return true;
            }
        }
        if self.is_interior[c] {
            let holders = self.holders[c].clone();
            for h in &holders {
                let h = self.find(*h);
                if h != c && Some(h) != route && self.observable(h, &mut HashSet::new()) {
                    return true;
                }
            }
            // The containers actually held here: seen through anything but these holders.
            let contents = self.contents[c].clone();
            for k in contents {
                let k = self.find(k);
                if k == c {
                    continue;
                }
                if self.outside[k] || !self.bindings[k].is_empty() {
                    return true;
                }
                let other_holders: Vec<Class> = self.held_in[k]
                    .clone()
                    .into_iter()
                    .filter(|h| {
                        let h = self.find(*h);
                        self.existing_interior(h).is_none_or(|hi| hi != c)
                    })
                    .collect();
                for h in other_holders {
                    if self.observable(h, &mut HashSet::new()) {
                        return true;
                    }
                }
                if self.seen_elsewhere_in(k, None, route, seen) {
                    return true;
                }
            }
        }
        false
    }
}

/// What a name resolves to.
#[derive(Clone, Copy)]
enum Slot {
    Local(Span),
    /// A `for (const e of r...)` element looped by reference: writes through `e` land `depth`
    /// member steps below the binding `r`.
    View(Span, usize),
}

enum Target {
    /// A write `depth` steps below this binding (1 = into it).
    Binding(Span, usize),
    /// A write into a container value with no binding (a call result, an element of one).
    Value(Class, usize),
    /// A module value or a global.
    Outside,
}

struct Write {
    target: Target,
    name: String,
    span: Span,
    /// The write is a callee's by-reference write at this call.
    call: Option<Span>,
    /// The write goes through a named function an array method calls with copies.
    named_callback: Option<String>,
}

struct Walk<'o, 'a> {
    oracle: &'o Oracle<'a>,
    uf: Uf,
    scopes: Vec<HashMap<String, Slot>>,
    classes: HashMap<Span, Class>,
    /// Local function bindings → their return class.
    closures: HashMap<Span, Class>,
    /// The return class of each function being walked (innermost last).
    returns: Vec<Class>,
    /// Inline callback element parameters → the array method passing them.
    callback_params: HashMap<Span, String>,
    /// A callback element's class → the receiver element class it copies.
    copies: HashMap<Class, Class>,
    /// Callback element parameters declared by the last inline callback.
    last_callback: Vec<Span>,
    /// A callback element parameter → the array its callback's results build (`map`).
    callback_route: HashMap<Span, Class>,
    writes: Vec<Write>,
}

impl Walk<'_, '_> {
    fn lookup(&self, name: &str) -> Option<Slot> {
        self.scopes.iter().rev().find_map(|s| s.get(name).copied())
    }

    fn is_container(&self, e: &Expr) -> bool {
        self.oracle.types.get(&e.span).is_none_or(container)
    }

    /// Whether a value of `e`'s type can hold a container inside it.
    fn holds_containers(&self, e: &Expr) -> bool {
        fn inner(t: &Ty) -> bool {
            match t {
                Ty::Union(ts) => ts.iter().any(inner),
                Ty::Array(t) | Ty::Map(t) => container(t),
                Ty::Tuple(ts) | Ty::ArrayLiteral(ts) => ts.iter().any(container),
                Ty::Obj(fields) => fields.values().any(|(t, _)| container(t)),
                Ty::Unknown => true,
                _ => false,
            }
        }
        self.oracle.types.get(&e.span).is_none_or(inner)
    }

    fn binding_is_container(&self, b: Span) -> bool {
        self.oracle.bindings.get(&b).is_none_or(container)
    }

    // ---- bindings --------------------------------------------------------------------------

    fn binding_class(&mut self, span: Span) -> Class {
        if let Some(c) = self.classes.get(&span) {
            return *c;
        }
        let c = self.uf.new_class();
        self.uf.bindings[c].push(span);
        self.classes.insert(span, c);
        c
    }

    fn declare(&mut self, name: &str, span: Span, value: Option<Class>) {
        self.scopes
            .last_mut()
            .expect("scope")
            .insert(name.to_string(), Slot::Local(span));
        if !self.binding_is_container(span) {
            return;
        }
        let c = self.binding_class(span);
        if let Some(v) = value {
            self.uf.unite(c, v);
        }
    }

    fn declare_pat(&mut self, pat: &Pat, value: Option<Class>) {
        match pat {
            Pat::Id(n, span) => self.declare(n, *span, value),
            Pat::Default(p, d) => {
                let dv = self.expr(d);
                let v = self.join(value, dv);
                self.declare_pat(p, v);
            }
            Pat::Obj { props, rest, .. } => {
                // A member of a container that never held one (`{}` or `{ n: 1 }` read back
                // through its declared type): nothing to share, each default stands alone.
                let member = value.and_then(|v| {
                    if self.uf.holds_anything(v) {
                        Some(self.uf.interior(v))
                    } else {
                        None
                    }
                });
                for (_, p) in props {
                    self.declare_pat(p, member);
                }
                if let Some((n, span)) = rest {
                    let copy = value.map(|v| self.shallow(v));
                    self.declare(n, *span, copy);
                }
            }
            Pat::Arr { elems, rest, .. } => {
                let member = value.and_then(|v| {
                    if self.uf.holds_anything(v) {
                        Some(self.uf.interior(v))
                    } else {
                        None
                    }
                });
                for p in elems.iter().flatten() {
                    self.declare_pat(p, member);
                }
                if let Some((n, span)) = rest {
                    let copy = value.map(|v| self.shallow(v));
                    self.declare(n, *span, copy);
                }
            }
        }
    }

    /// Function parameters: their own classes (a caller passes them by reference when written),
    /// which may hold anything the caller put in them.
    fn params(&mut self, params: &[Param]) {
        for p in params {
            let o = self.uf.new_class();
            self.uf.opaque[o] = true;
            self.declare_pat(&p.pat, Some(o));
            if let Some(d) = &p.default {
                let dv = self.expr(d);
                self.bind_pat_value(&p.pat, dv);
            }
        }
    }

    /// Joins a default value into the bindings of an already declared pattern.
    fn bind_pat_value(&mut self, pat: &Pat, value: Option<Class>) {
        let Some(v) = value else { return };
        match pat {
            Pat::Id(_, span) => {
                if let Some(c) = self.classes.get(span).copied() {
                    self.uf.unite(c, v);
                }
            }
            Pat::Default(p, _) => self.bind_pat_value(p, Some(v)),
            Pat::Obj { props, .. } => {
                let m = self.uf.interior(v);
                for (_, p) in props {
                    self.bind_pat_value(p, Some(m));
                }
            }
            Pat::Arr { elems, .. } => {
                let m = self.uf.interior(v);
                for p in elems.iter().flatten() {
                    self.bind_pat_value(p, Some(m));
                }
            }
        }
    }

    fn body(&mut self, body: &FnBody) {
        match body {
            FnBody::Expr(e) => {
                let v = self.expr(e);
                self.returned(v);
            }
            FnBody::Block(b) => self.stmts(b),
        }
    }

    fn returned(&mut self, v: Option<Class>) {
        if let (Some(v), Some(r)) = (v, self.returns.last().copied()) {
            self.uf.unite(r, v);
        }
    }

    /// A nested function: walked once with the enclosing scopes. Returns its return class.
    fn closure(&mut self, f: &Func) -> Class {
        let r = self.uf.new_class();
        self.returns.push(r);
        self.scopes.push(HashMap::new());
        self.params(&f.params);
        self.body(&f.body);
        self.scopes.pop();
        self.returns.pop();
        r
    }

    // ---- values ----------------------------------------------------------------------------

    fn join(&mut self, a: Option<Class>, b: Option<Class>) -> Option<Class> {
        match (a, b) {
            (Some(a), Some(b)) => {
                self.uf.unite(a, b);
                Some(a)
            }
            (a, b) => a.or(b),
        }
    }

    /// A new container holding `v`'s members.
    fn shallow(&mut self, v: Class) -> Class {
        let n = self.uf.new_class();
        let ni = self.uf.interior(n);
        let vi = self.uf.interior(v);
        self.uf.unite(ni, vi);
        n
    }

    /// `v` is now held inside `holder`.
    fn store(&mut self, holder: Class, v: Option<Class>) {
        if let Some(v) = v {
            self.uf.store(holder, v);
        }
    }

    fn escape(&mut self, v: Option<Class>) {
        if let Some(v) = v {
            self.uf.mark_outside(v);
        }
    }

    fn class_of_slot(&mut self, slot: Slot) -> Option<Class> {
        match slot {
            Slot::Local(b) => {
                if self.binding_is_container(b) {
                    Some(self.binding_class(b))
                } else {
                    None
                }
            }
            Slot::View(root, _) => {
                let c = self.binding_class(root);
                Some(self.uf.interior(c))
            }
        }
    }

    // ---- statements ------------------------------------------------------------------------

    fn stmts(&mut self, stmts: &[Stmt]) {
        self.scopes.push(HashMap::new());
        // Function declarations are hoisted.
        for s in stmts {
            let s = match s {
                Stmt::Exported(s) => &**s,
                s => s,
            };
            if let Stmt::Func(f) = s
                && let Some(n) = &f.name
            {
                self.scopes.last_mut().unwrap().insert(n.clone(), Slot::Local(f.span));
            }
        }
        for s in stmts {
            self.stmt(s);
        }
        self.scopes.pop();
    }

    fn stmt(&mut self, s: &Stmt) {
        match s {
            Stmt::Decl { pat, init, .. } => {
                let v = match init {
                    Some(Expr {
                        kind: ExprKind::Func(f),
                        ..
                    }) => {
                        let r = self.closure(f);
                        if let Pat::Id(_, span) = pat {
                            self.closures.insert(*span, r);
                        }
                        None
                    }
                    Some(e) => self.expr(e),
                    None => None,
                };
                self.declare_pat(pat, v);
            }
            Stmt::Expr(e) => {
                self.expr(e);
            }
            Stmt::Throw(e) | Stmt::ExportDefault(e) => {
                let v = self.expr(e);
                self.escape(v);
            }
            Stmt::Return(Some(e), _) => {
                let v = self.expr(e);
                self.returned(v);
            }
            Stmt::If(t, a, b) => {
                self.expr(t);
                self.stmts(a);
                if let Some(b) = b {
                    self.stmts(b);
                }
            }
            Stmt::Block(b) => self.stmts(b),
            Stmt::While(t, b) => {
                self.expr(t);
                self.stmts(b);
            }
            Stmt::For {
                init,
                test,
                update,
                body,
                ..
            } => {
                self.scopes.push(HashMap::new());
                if let Some(i) = init {
                    self.stmt(i);
                    // compile.rs gives each iteration a fresh cell for a captured `let`; a cell
                    // copies a container, so a captured container loop variable is shared.
                    if let Stmt::Decl { pat, .. } = &**i {
                        self.cell_bindings(pat);
                    }
                }
                if let Some(t) = test {
                    self.expr(t);
                }
                if let Some(u) = update {
                    self.expr(u);
                }
                self.stmts(body);
                self.scopes.pop();
            }
            Stmt::ForOf { pat, iter, body, .. } => {
                let it = self.expr(iter);
                self.scopes.push(HashMap::new());
                // compile.rs loops over a place by reference when the body writes its element:
                // writes through the element land inside that place's binding.
                let view = match pat {
                    Pat::Id(n, _) if self.oracle.effects.by_ref(pat) => Self::root(iter)
                        .and_then(|(name, depth)| self.lookup(name).map(|s| (s, depth)))
                        .map(|(slot, depth)| (n.clone(), slot, depth)),
                    _ => None,
                };
                match view {
                    Some((n, slot, depth)) => {
                        let v = match slot {
                            Slot::Local(root) => Slot::View(root, depth + 1),
                            Slot::View(root, d) => Slot::View(root, d + depth + 1),
                        };
                        self.scopes.last_mut().unwrap().insert(n, v);
                    }
                    None => {
                        let el = Some(match it {
                            Some(c) => self.uf.interior(c),
                            None => self.uf.outside_class(),
                        });
                        self.declare_pat(pat, el);
                    }
                }
                self.stmts(body);
                self.scopes.pop();
            }
            Stmt::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                self.stmts(block);
                if let Some(h) = handler {
                    self.scopes.push(HashMap::new());
                    if let Some((n, span)) = param {
                        let o = self.uf.outside_class();
                        self.declare(n, *span, Some(o));
                    }
                    self.stmts(h);
                    self.scopes.pop();
                }
                if let Some(f) = finalizer {
                    self.stmts(f);
                }
            }
            Stmt::Switch { disc, cases, .. } => {
                self.expr(disc);
                for (t, b) in cases {
                    if let Some(t) = t {
                        self.expr(t);
                    }
                    self.stmts(b);
                }
            }
            Stmt::Exported(s) => self.stmt(s),
            Stmt::Func(f) => {
                let r = self.closure(f);
                self.closures.insert(f.span, r);
            }
            Stmt::Return(None, _)
            | Stmt::Break(_)
            | Stmt::Continue(_)
            | Stmt::TypeAlias { .. }
            | Stmt::Import { .. }
            | Stmt::ExportNames { .. }
            | Stmt::ExportAll { .. } => {}
        }
    }

    /// Captured `for (let ...)` bindings that hold a container: each iteration's cell is a copy.
    fn cell_bindings(&mut self, pat: &Pat) {
        let mut spans = Vec::new();
        super::pat_bindings(pat, &mut spans);
        for b in spans {
            if self.oracle.effects.captured(b) && self.binding_is_container(b) {
                let c = self.binding_class(b);
                self.uf.mark_outside(c);
            }
        }
    }

    // ---- expressions -----------------------------------------------------------------------

    /// The local an interior write goes into and how many member steps below it.
    fn root(target: &Expr) -> Option<(&str, usize)> {
        match &target.kind {
            ExprKind::Ident(n) => Some((n, 0)),
            ExprKind::Member { obj, .. } | ExprKind::Index { obj, .. } => Self::root(obj).map(|(n, d)| (n, d + 1)),
            ExprKind::NonNull(x) | ExprKind::As(x, _) | ExprKind::Chain(x) => Self::root(x),
            _ => None,
        }
    }

    /// Record a write `extra` steps below the place `target` (0 for `target = v` with a member
    /// target, 1 for `target.push(v)` or a call writing its parameter `target`). `value` is the
    /// class of `target` itself, for targets with no binding.
    fn write(&mut self, target: &Expr, extra: usize, span: Span, value: Option<Class>) {
        let (t, name) = match Self::root(target) {
            Some((name, depth)) => match self.lookup(name) {
                Some(Slot::Local(b)) => (Target::Binding(b, depth + extra), name.to_string()),
                Some(Slot::View(root, d)) => (Target::Binding(root, d + depth + extra), name.to_string()),
                None => (Target::Outside, name.to_string()),
            },
            None => match value {
                Some(c) => (Target::Value(c, extra.max(1)), "this value".to_string()),
                None => return,
            },
        };
        if matches!(t, Target::Binding(_, 0)) {
            return;
        }
        self.writes.push(Write {
            target: t,
            name,
            span,
            named_callback: None,
            call: None,
        });
    }

    fn expr(&mut self, e: &Expr) -> Option<Class> {
        let container = self.is_container(e);
        let v = self.expr_inner(e);
        if container { v } else { None }
    }

    fn expr_inner(&mut self, e: &Expr) -> Option<Class> {
        match &e.kind {
            ExprKind::Num(_)
            | ExprKind::Str(_)
            | ExprKind::Bool(_)
            | ExprKind::Null
            | ExprKind::Undefined
            | ExprKind::Regex { .. } => None,
            ExprKind::Template(_, xs) => {
                for x in xs {
                    self.expr(x);
                }
                None
            }
            ExprKind::Binary(_, a, b) => {
                self.expr(a);
                self.expr(b);
                None
            }
            ExprKind::Unary(_, x) | ExprKind::IsNullish(x, _) => {
                self.expr(x);
                None
            }
            ExprKind::Func(f) => {
                self.closure(f);
                None
            }
            ExprKind::Array(items) => {
                let n = self.uf.new_class();
                for it in items {
                    match it {
                        ArrEl::Item(x) => {
                            let v = self.expr(x);
                            self.store(n, v);
                        }
                        ArrEl::Spread(x) => {
                            if let Some(v) = self.expr(x) {
                                let vi = self.uf.interior(v);
                                self.store(n, Some(vi));
                            }
                        }
                    }
                }
                Some(n)
            }
            ExprKind::Object(props) => {
                let n = self.uf.new_class();
                for p in props {
                    match p {
                        Prop::KV(k, x) => {
                            if let PropKey::Computed(k) = k {
                                self.expr(k);
                            }
                            let v = self.expr(x);
                            self.store(n, v);
                        }
                        Prop::Spread(x) => {
                            if let Some(v) = self.expr(x) {
                                let vi = self.uf.interior(v);
                                self.store(n, Some(vi));
                            }
                        }
                    }
                }
                Some(n)
            }
            ExprKind::New { callee, args } => {
                self.expr(callee);
                for a in args {
                    let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
                    let v = self.expr(x);
                    self.escape(v);
                }
                Some(self.uf.new_class())
            }
            ExprKind::Ident(n) => match self.lookup(n) {
                Some(slot) => self.class_of_slot(slot),
                // A module value or a global: shared with the config.
                None => Some(self.uf.outside_class()),
            },
            ExprKind::Member { obj, .. } => {
                let o = self.expr(obj);
                Some(match o {
                    Some(o) => self.uf.interior(o),
                    None => self.uf.outside_class(),
                })
            }
            ExprKind::Index { obj, index, .. } => {
                let o = self.expr(obj);
                self.expr(index);
                Some(match o {
                    Some(o) => self.uf.interior(o),
                    None => self.uf.outside_class(),
                })
            }
            ExprKind::NonNull(x) | ExprKind::As(x, _) | ExprKind::Chain(x) | ExprKind::Await(x) => self.expr(x),
            ExprKind::Cond(t, a, b) => {
                self.expr(t);
                let a = self.expr(a);
                let b = self.expr(b);
                self.join(a, b)
            }
            ExprKind::Logical(_, a, b) => {
                let a = self.expr(a);
                let b = self.expr(b);
                self.join(a, b)
            }
            ExprKind::Assign { target, value, .. } => {
                let v = self.expr(value);
                match &target.kind {
                    ExprKind::Ident(n) => {
                        if let Some(slot) = self.lookup(n)
                            && let Some(c) = self.class_of_slot(slot)
                            && let Some(v) = v
                        {
                            self.uf.unite(c, v);
                        }
                    }
                    ExprKind::Member { obj, .. } | ExprKind::Index { obj, .. } => {
                        if let ExprKind::Index { index, .. } = &target.kind {
                            self.expr(index);
                        }
                        let holder = self.expr(obj);
                        self.write(target, 0, e.span, holder);
                        match holder {
                            Some(h) => self.store(h, v),
                            None => self.escape(v),
                        }
                    }
                    _ => {
                        self.expr(target);
                    }
                }
                v
            }
            ExprKind::Update { target, .. } => {
                if let ExprKind::Member { obj, .. } | ExprKind::Index { obj, .. } = &target.kind {
                    if let ExprKind::Index { index, .. } = &target.kind {
                        self.expr(index);
                    }
                    let holder = self.expr(obj);
                    self.write(target, 0, e.span, holder);
                }
                None
            }
            ExprKind::Call { callee, args, .. } => self.call(e, callee, args),
        }
    }

    fn arg_classes(&mut self, args: &[ArrEl]) -> Vec<Option<Class>> {
        args.iter()
            .map(|a| match a {
                ArrEl::Item(x) => self.expr(x),
                ArrEl::Spread(x) => self.expr(x).map(|c| self.uf.interior(c)),
            })
            .collect()
    }

    fn global<'e>(&self, obj: &'e Expr) -> Option<&'e str> {
        match &obj.kind {
            ExprKind::Ident(g) if self.lookup(g).is_none() && GLOBALS.contains(&g.as_str()) => Some(g),
            _ => None,
        }
    }

    fn call(&mut self, e: &Expr, callee: &Expr, args: &[ArrEl]) -> Option<Class> {
        if self.oracle.effects.resolved(e.span) {
            return self.resolved_call(e, callee, args);
        }
        let ExprKind::Member { obj, prop, .. } = &callee.kind else {
            self.expr(callee);
            let argv = self.arg_classes(args);
            for v in argv {
                self.escape(v);
            }
            return Some(self.uf.outside_class());
        };
        if is_db_chain(obj) {
            self.expr(obj);
            self.arg_classes(args);
            return Some(self.uf.new_class());
        }
        if let Some(g) = self.global(obj) {
            let mapped = (g, prop.as_str()) == ("Array", "from") && args.len() >= 2;
            let argv = if mapped {
                self.arg_classes(&args[..1])
            } else {
                self.arg_classes(args)
            };
            let n = self.uf.new_class();
            match (g, prop.as_str()) {
                ("Array", "from") if args.len() >= 2 => {
                    // `Array.from(src, fn)` maps: the function gets copies of src's elements.
                    let src = argv.first().copied().flatten();
                    if let Some(ArrEl::Item(cb)) = args.get(1) {
                        let ret = self.callback(e, cb, "Array.from", 0, src);
                        if let Some(r) = ret {
                            self.store(n, Some(r));
                        }
                    }
                }
                ("Object", "values" | "entries") | ("Array", "from") => {
                    if let Some(Some(a)) = argv.first() {
                        let ai = self.uf.interior(*a);
                        self.store(n, Some(ai));
                    }
                }
                ("Object", "fromEntries") => {
                    if let Some(Some(a)) = argv.first() {
                        let ai = self.uf.interior(*a);
                        self.store(n, Some(ai));
                    }
                }
                ("Array", "of") => {
                    for a in argv {
                        self.store(n, a);
                    }
                }
                ("JSON" | "Math" | "Number" | "String" | "Object" | "Array" | "Date" | "Boolean", _) => {}
                _ => self.uf.mark_outside(n),
            }
            return Some(n);
        }
        let recv = self.expr(obj);
        let p = prop.as_str();
        let callback = CALLBACK_METHODS.iter().find(|(m, _)| *m == p).map(|(_, i)| *i);
        let mut argv: Vec<Option<Class>> = Vec::new();
        let mut cb_return: Option<Class> = None;
        let mut cb_params: Vec<Span> = Vec::new();
        for (i, a) in args.iter().enumerate() {
            if i == 0
                && let Some(el) = callback
                && let ArrEl::Item(x) = a
            {
                cb_return = self.callback(e, x, p, el, recv);
                cb_params = std::mem::take(&mut self.last_callback);
                argv.push(None);
                continue;
            }
            argv.push(match a {
                ArrEl::Item(x) => self.expr(x),
                ArrEl::Spread(x) => self.expr(x).map(|c| self.uf.interior(c)),
            });
        }
        if MUTATORS.contains(&p) {
            self.write(obj, 1, e.span, recv);
            if let Some(r) = recv
                && matches!(p, "push" | "unshift" | "splice" | "fill")
            {
                let from = if p == "splice" { 2 } else { 0 };
                for v in argv.iter().skip(from) {
                    self.store(r, *v);
                }
            }
        }
        let Some(r) = recv else {
            return Some(self.uf.new_class());
        };
        if matches!(p, "sort" | "reverse" | "fill" | "copyWithin") {
            return Some(r);
        }
        if SHALLOW_METHODS.contains(&p) {
            let n = self.shallow(r);
            if p == "concat" {
                for v in argv.into_iter().flatten() {
                    self.store(n, Some(v));
                    let vi = self.uf.interior(v);
                    self.store(n, Some(vi));
                }
            }
            return Some(n);
        }
        if ELEMENT_METHODS.contains(&p) {
            return Some(self.uf.interior(r));
        }
        match p {
            "map" | "flatMap" => {
                let n = self.uf.new_class();
                for p in std::mem::take(&mut cb_params) {
                    self.callback_route.insert(p, n);
                }
                // In JS, an element the callback returns is the receiver's element itself: the
                // result holds it (and so do later reads of the receiver).
                if let Some(c) = cb_return {
                    let c2 = self.uf.find(c);
                    let copies: Vec<Class> = self.copies.keys().copied().collect();
                    let returns_copy = copies.into_iter().any(|k| self.uf.find(k) == c2);
                    if returns_copy && let Some(r) = recv {
                        let ri = self.uf.interior(r);
                        self.store(n, Some(ri));
                    }
                }
                if let Some(c) = cb_return {
                    self.store(n, Some(c));
                    if p == "flatMap" {
                        let ci = self.uf.interior(c);
                        self.store(n, Some(ci));
                    }
                }
                Some(n)
            }
            "reduce" | "reduceRight" => {
                let ri = self.uf.interior(r);
                let init = argv.get(1).copied().flatten();
                let acc = self.join(Some(ri), init);
                self.join(acc, cb_return)
            }
            _ if FRESH_METHODS.contains(&p) => Some(self.uf.new_class()),
            _ => Some(self.uf.outside_class()),
        }
    }

    /// The callback an array method calls with copies of the receiver's elements.
    fn callback(&mut self, call: &Expr, cb: &Expr, method: &str, el: usize, recv: Option<Class>) -> Option<Class> {
        let element = recv.map(|r| self.uf.interior(r));
        match &cb.kind {
            ExprKind::Func(f) => {
                self.last_callback.clear();
                let r = self.uf.new_class();
                self.returns.push(r);
                self.scopes.push(HashMap::new());
                let comparator = matches!(method, "sort" | "toSorted");
                for (i, p) in f.params.iter().enumerate() {
                    // The element is a copy of one of the receiver's elements: its own class,
                    // holding what the element holds. A write into it is judged against the
                    // receiver's element (see `verify`). A reduce accumulator may be an element;
                    // both comparator parameters are elements.
                    let is_element = i == el || (comparator && i == 1);
                    let v = if is_element {
                        // PHP's copy shares nothing with the element; JS's element is the
                        // original. A write through the copy (at any depth) is lost exactly when
                        // the original can be seen again.
                        element.map(|e| {
                            let copy = self.uf.new_class();
                            self.copies.insert(copy, e);
                            copy
                        })
                    } else if el == 1 && i == 0 {
                        element
                    } else {
                        None
                    };
                    self.declare_pat(&p.pat, v);
                    if is_element && let Pat::Id(_, span) = &p.pat {
                        self.callback_params.insert(*span, method.to_string());
                        self.last_callback.push(*span);
                    }
                }
                let params = std::mem::take(&mut self.last_callback);
                self.body(&f.body);
                self.last_callback = params;
                self.scopes.pop();
                self.returns.pop();
                Some(r)
            }
            _ => {
                self.expr(cb);
                if let Some(depth) = self.oracle.effects.callback_write_depth(call.span, el)
                    && let Some(element) = element
                {
                    self.writes.push(Write {
                        target: Target::Value(element, depth),
                        name: method.to_string(),
                        span: cb.span,
                        named_callback: Some(method.to_string()),
                        call: None,
                    });
                }
                // What a named callback returns may be an element or anything it captured.
                let o = self.uf.outside_class();
                if let Some(element) = element {
                    self.uf.unite(o, element);
                }
                Some(o)
            }
        }
    }

    /// A call to a function of this program.
    fn resolved_call(&mut self, e: &Expr, callee: &Expr, args: &[ArrEl]) -> Option<Class> {
        let fx = self.oracle.effects;
        // A local function: its return class. Otherwise unknown sharing inside its result.
        let local = match &callee.kind {
            ExprKind::Ident(n) => match self.lookup(n) {
                Some(Slot::Local(b)) => self.closures.get(&b).copied(),
                _ => None,
            },
            ExprKind::Func(f) => Some(self.closure(f)),
            _ => None,
        };
        if !matches!(callee.kind, ExprKind::Func(_)) {
            self.expr(callee);
        }
        let argv = self.arg_classes(args);
        let result = self.uf.new_class();
        match local {
            Some(r) => self.uf.unite(result, r),
            None => {
                // A module helper: its result may be a value it captured, and the containers
                // inside it may be the same one twice.
                if fx.result_shared(e.span) {
                    self.uf.mark_outside(result);
                } else {
                    let i = self.uf.interior(result);
                    self.uf.mark_outside(i);
                }
            }
        }
        // A written argument passed by reference while another argument may be (or hold, or sit
        // inside) the same container: JS sees one object through both parameters, PHP two.
        for (i, vi) in argv.iter().enumerate() {
            let Some(vi) = vi else { continue };
            if fx.argument_write_depth(e.span, i).is_none() {
                continue;
            }
            for (j, vj) in argv.iter().enumerate() {
                let Some(vj) = vj else { continue };
                if i != j && self.uf.overlap(*vi, *vj) {
                    let (ArrEl::Item(x) | ArrEl::Spread(x)) = &args[j];
                    let name = Self::root(x).map_or("this argument".to_string(), |(n, _)| n.to_string());
                    self.writes.push(Write {
                        target: Target::Outside,
                        name,
                        span: x.span,
                        named_callback: None,
                        call: None,
                    });
                }
            }
        }
        for (i, a) in args.iter().enumerate() {
            let (ArrEl::Item(x) | ArrEl::Spread(x)) = a;
            let v = argv.get(i).copied().flatten();
            if let Some(depth) = fx.argument_write_depth(e.span, i) {
                // compile.rs passes a place by reference; anything else is a copy.
                self.write(x, depth, x.span, v);
                if let Some(w) = self.writes.last_mut()
                    && w.span == x.span
                {
                    w.call = Some(e.span);
                }
            }
            if fx.argument_stored(e.span, i)
                && let Some(v) = v
            {
                // Kept by the callee past the call: held by a keeper only it reaches. The callee's
                // own writes reach it by reference; anything written later doesn't.
                let keeper = self.uf.new_class();
                self.uf.keepers[keeper] = Some(e.span);
                self.uf.store(keeper, v);
            }
            // A member of it is kept by the callee beyond the call (only matters when the
            // argument can hold containers).
            if fx.argument_member_stored(e.span, i) && self.holds_containers(x) {
                let vi = v.map(|c| self.uf.interior(c));
                self.escape(vi);
            }
            // The callee may store a container it holds (a captured or module value) inside the
            // argument: reading members of the argument may then give that value.
            if fx.stores_into_argument(e.span, i)
                && let Some(v) = v
            {
                let o = self.uf.outside_class();
                self.uf.store(v, o);
            }
            // Returned: the result may be the argument itself, or a member of it.
            if let Some(v) = v
                && self.is_container(e)
            {
                if fx.argument_retained(e.span, i) {
                    self.uf.unite(result, v);
                }
                if fx.argument_member_returned(e.span, i) {
                    let vi = self.uf.interior(v);
                    self.uf.unite(result, vi);
                    let ri = self.uf.interior(result);
                    self.uf.unite(ri, vi);
                }
            }
        }
        Some(result)
    }

    // ---- verdict ---------------------------------------------------------------------------

    fn verify(&mut self) -> Result<()> {
        let writes = std::mem::take(&mut self.writes);
        for w in &writes {
            let unsafe_write = match w.target {
                Target::Outside => true,
                // A callback's element is a copy of the receiver's element: lost if anything else
                // can see that element (another binding, the receiver held anywhere).
                // A callback's element is a copy: a write into it is lost when the receiver's
                // element can be seen again (the receiver is observable), or when the copy itself
                // is shared with something else.
                Target::Binding(b, depth) if self.callback_params.contains_key(&b) => {
                    match self.classes.get(&b).copied() {
                        Some(c) => {
                            let c = self.uf.find(c);
                            let element = self
                                .copies
                                .clone()
                                .into_iter()
                                .find(|(k, _)| self.uf.find(*k) == c)
                                .map(|(_, e)| e);
                            // Interiors collapse (an element's members share its class), so the
                            // copy is excluded when asking who else can see the element.
                            // Returning the changed copy from `map` is what JS returns too: the
                            // map result doesn't count as seeing the original element.
                            let route = self.callback_route.get(&b).copied();
                            let lost = match element {
                                Some(e) => {
                                    let e = self.uf.find(e);
                                    let mut skip = HashSet::from([c]);
                                    if let Some(r) = route {
                                        skip.insert(self.uf.find(r));
                                    }
                                    e != c && self.uf.observable(e, &mut skip)
                                }
                                None => true,
                            };
                            lost || self.unsafe_routed(c, b, route, depth)
                        }
                        None => false,
                    }
                }
                Target::Binding(b, depth) => match (self.classes.get(&b).copied(), w.call) {
                    (Some(c), Some(call)) => {
                        let c = self.uf.find(c);
                        self.uf.seen_elsewhere_but(c, Some(b), call) || depth >= 2 && self.unsafe_at(c, Some(b), depth)
                    }
                    (Some(c), None) => self.unsafe_at(c, Some(b), depth),
                    (None, _) => false,
                },
                // A temporary (`[3, 1].sort()`, `f().x = 1`): what it flows into is the same
                // value in PHP too; it's a copy only of something held elsewhere.
                Target::Value(c, depth) => self.unsafe_value(c, depth),
            };
            if unsafe_write {
                return Err(self.reject(w));
            }
        }
        Ok(())
    }

    fn unsafe_at(&mut self, c: Class, binding: Option<Span>, depth: usize) -> bool {
        let c = self.uf.find(c);
        if self.uf.seen_elsewhere(c, binding, None) {
            return true;
        }
        if depth >= 2
            && let Some(i) = self.uf.existing_interior(c)
            && i != c
            && self.uf.seen_elsewhere(i, None, Some(c))
        {
            return true;
        }
        false
    }

    fn unsafe_routed(&mut self, c: Class, b: Span, route: Option<Class>, depth: usize) -> bool {
        let c = self.uf.find(c);
        if self.uf.seen_elsewhere(c, Some(b), route) {
            return true;
        }
        if depth >= 2
            && let Some(i) = self.uf.existing_interior(c)
            && i != c
            && self.uf.seen_elsewhere(i, None, Some(c))
        {
            return true;
        }
        false
    }

    fn unsafe_value(&mut self, c: Class, depth: usize) -> bool {
        let c = self.uf.find(c);
        let bindings = std::mem::take(&mut self.uf.bindings[c]);
        let r = self.unsafe_at(c, None, depth);
        self.uf.bindings[c] = bindings;
        r
    }

    fn reject(&self, w: &Write) -> Diag {
        if let Some(method) = &w.named_callback {
            return Diag::new(
                w.span,
                format!("`{method}` passes each element to this function as a copy in compiled PHP, so its changes would be lost"),
            )
            .help("use `for (const item of list) { ... }` and change `item` there");
        }
        if let Target::Binding(b, _) = w.target
            && let Some(method) = self.callback_params.get(&b)
        {
            return Diag::new(
                w.span,
                format!("`{method}` passes each element to the callback as a copy in compiled PHP, so this change would be lost"),
            )
            .help("use `for (const item of list) { item.x = ... }`, which changes the elements themselves");
        }
        Diag::new(
            w.span,
            format!(
                "`{}` may be the same object or array as another value here, and compiled PHP copies it: this change wouldn't show up there",
                w.name
            ),
        )
        .help("change the original directly (for example `list[i].x = ...` instead of through a copy), or make an explicit copy first and use it from then on (`const b = { ...a }` / `[...a]`) — note a spread copy only copies the top level")
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
