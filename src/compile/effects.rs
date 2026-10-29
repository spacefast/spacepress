//! Flow-insensitive mutation effects, computed before return/capture inference.
//! Binding spans distinguish shadowed locals; call edges carry parameter paths
//! back to arguments without treating scalar parameter assignment as a write.

use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(super) enum Step {
    Field(String),
    Index,
    /// Recursive calls can reach descendants beyond the program's explicit paths.
    Descendants,
    Result,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct Place {
    binding: Span,
    path: Vec<Step>,
}

impl Place {
    fn new(binding: Span) -> Self {
        Self {
            binding,
            path: Vec::new(),
        }
    }
    fn at(&self, step: Step) -> Self {
        let mut place = self.clone();
        place.path.push(step);
        place
    }
}

#[derive(Default)]
pub(super) struct Effects {
    numeric: HashMap<Span, HashSet<Vec<Step>>>,
    incoming: HashMap<Span, HashSet<Vec<Step>>>,
    writes: HashSet<Place>,
    events: HashMap<Span, HashSet<Place>>,
}

impl Effects {
    pub fn analyze(roots: &[Root]) -> Self {
        let mut graph = Graph::default();
        for root in roots {
            graph.function(&root.closure.func, &[], &root.closure.env);
            graph.reachable.insert(root.closure.func.span);
        }
        graph.solve()
    }

    pub fn read_view_type(&self, binding: Span, view: &[Step], ty: &Ty) -> Ty {
        self.numeric.get(&binding).map_or_else(
            || ty.clone(),
            |paths| {
                paths
                    .iter()
                    .filter(|path| path.starts_with(view))
                    .fold(ty.clone(), |ty, path| widen(&ty, &path[view.len()..]))
            },
        )
    }

    pub fn shared(&self, binding: Span) -> bool {
        self.writes.iter().any(|p| p.binding == binding)
    }

    /// Parameter constraints remain authored, but callers may already have
    /// changed numeric values beyond those constraints before invoking us.
    pub fn parameter_type(&self, binding: Span, ty: &Ty) -> Ty {
        self.incoming.get(&binding).map_or_else(
            || ty.clone(),
            |paths| paths.iter().fold(ty.clone(), |ty, path| widen(&ty, path)),
        )
    }

    pub fn by_ref(&self, pat: &Pat) -> bool {
        matches!(pat, Pat::Id(_, span) if self.writes.iter().any(|p| p.binding == *span && !p.path.is_empty()))
    }

    pub fn write_type(&self, event: Span, binding: Span, view: &[Step], ty: &Ty) -> Ty {
        self.events.get(&event).map_or_else(
            || ty.clone(),
            |paths| {
                paths
                    .iter()
                    .filter(|p| p.binding == binding && p.path.starts_with(view))
                    .fold(ty.clone(), |ty, p| widen(&ty, &p.path[view.len()..]))
            },
        )
    }
}

fn widen(ty: &Ty, path: &[Step]) -> Ty {
    let Some((step, rest)) = path.split_first() else {
        return match ty {
            Ty::Num | Ty::NumLit(_) | Ty::FreshNumLit(_) => Ty::Num,
            Ty::Union(ts) => Ty::union(ts.iter().map(|t| widen(t, path))),
            _ => ty.clone(),
        };
    };
    match (ty, step) {
        (Ty::Union(ts), _) => Ty::union(ts.iter().map(|t| widen(t, path))),
        (_, Step::Descendants) => match ty {
            Ty::Obj(fields) => Ty::Obj(
                fields
                    .iter()
                    .map(|(k, (t, opt))| (k.clone(), (widen(t, path), *opt)))
                    .collect(),
            ),
            Ty::Array(t) => Ty::Array(Box::new(widen(t, path))),
            Ty::Map(t) => Ty::Map(Box::new(widen(t, path))),
            Ty::Tuple(ts) => Ty::Tuple(ts.iter().map(|t| widen(t, path)).collect()),
            Ty::ArrayLiteral(ts) => Ty::ArrayLiteral(ts.iter().map(|t| widen(t, path)).collect()),
            _ => widen(ty, &[]),
        },
        (Ty::Obj(fields), Step::Field(field)) => {
            let mut fields = fields.clone();
            if let Some((ty, _)) = fields.get_mut(field) {
                *ty = widen(ty, rest);
            }
            Ty::Obj(fields)
        }
        (Ty::Obj(fields), Step::Index) => Ty::Obj(
            fields
                .iter()
                .map(|(k, (t, opt))| (k.clone(), (widen(t, rest), *opt)))
                .collect(),
        ),
        (Ty::Array(t), Step::Index) => Ty::Array(Box::new(widen(t, rest))),
        (Ty::Tuple(ts), Step::Index) => Ty::Tuple(ts.iter().map(|t| widen(t, rest)).collect()),
        (Ty::ArrayLiteral(ts), Step::Index) => Ty::ArrayLiteral(ts.iter().map(|t| widen(t, rest)).collect()),
        (Ty::Map(t), _) => Ty::Map(Box::new(widen(t, rest))),
        _ => ty.clone(),
    }
}

struct Call {
    callee: Place,
    args: Vec<Option<Place>>,
    result: Place,
    owner: Span,
    span: Span,
    prior: HashSet<Span>,
}

#[derive(Default)]
struct Graph {
    reachable: HashSet<Span>,
    incoming: HashSet<Place>,
    history: HashMap<Span, HashSet<Span>>,
    functions: HashMap<Span, Vec<Option<Place>>>,
    values: HashSet<(Place, Span)>,
    copies: HashSet<(Place, Place)>,
    calls: Vec<Call>,
    numeric: HashSet<Place>,
    writes: HashSet<Place>,
    max_depth: usize,
    bindings: HashMap<Span, Span>,
    function_numeric: HashMap<Span, HashSet<Place>>,
    function_writes: HashMap<Span, HashSet<Place>>,
    events: HashMap<Span, HashSet<Place>>,
}

type Names = Vec<HashMap<String, Place>>;

impl Graph {
    fn function(&mut self, f: &Rc<Func>, outer: &[HashMap<String, Place>], env: &Rc<Scope>) -> Place {
        let value = Place::new(f.span);
        self.values.insert((value.clone(), f.span));
        if self.functions.contains_key(&f.span) {
            return value;
        }
        self.functions.insert(f.span, Vec::new());
        let mut names = outer.to_vec();
        names.push(HashMap::new());
        if let Some(name) = &f.name {
            names.last_mut().unwrap().insert(name.clone(), value.clone());
        }
        let params = f
            .params
            .iter()
            .map(|p| {
                self.bind(&p.pat, &mut names, f.span);
                match &p.pat {
                    Pat::Id(_, span) => Some(Place::new(*span)),
                    _ => None,
                }
            })
            .collect();
        self.functions.insert(f.span, params);
        for p in &f.params {
            self.defaults(&p.pat, &mut names, env, f.span);
            if let Some(e) = &p.default {
                self.expr(e, &mut names, env, f.span);
            }
        }
        match &f.body {
            FnBody::Expr(e) => {
                let result = self.expr(e, &mut names, env, f.span);
                self.copy(result, Some(value.at(Step::Result)));
            }
            FnBody::Block(body) => self.block(body, &mut names, env, f.span),
        }
        value
    }

    fn bind(&mut self, pat: &Pat, names: &mut Names, owner: Span) {
        let mut bindings = Vec::new();
        fn collect(p: &Pat, out: &mut Vec<(String, Span)>) {
            match p {
                Pat::Id(name, span) => out.push((name.clone(), *span)),
                Pat::Default(p, _) => collect(p, out),
                Pat::Obj { props, rest, .. } => {
                    for (_, p) in props {
                        collect(p, out);
                    }
                    if let Some(p) = rest {
                        out.push(p.clone());
                    }
                }
                Pat::Arr { elems, rest, .. } => {
                    for p in elems.iter().flatten() {
                        collect(p, out);
                    }
                    if let Some(p) = rest {
                        out.push(p.clone());
                    }
                }
            }
        }
        collect(pat, &mut bindings);
        for (name, span) in bindings {
            names.last_mut().unwrap().insert(name, Place::new(span));
            self.bindings.insert(span, owner);
        }
    }

    fn defaults(&mut self, pat: &Pat, names: &mut Names, env: &Rc<Scope>, owner: Span) {
        match pat {
            Pat::Default(p, e) => {
                let value = self.expr(e, names, env, owner);
                self.bind_value(p, value);
                self.defaults(p, names, env, owner);
            }
            Pat::Obj { props, .. } => {
                for (_, p) in props {
                    self.defaults(p, names, env, owner);
                }
            }
            Pat::Arr { elems, .. } => {
                for p in elems.iter().flatten() {
                    self.defaults(p, names, env, owner);
                }
            }
            Pat::Id(..) => {}
        }
    }

    fn bind_value(&mut self, pat: &Pat, src: Option<Place>) {
        match pat {
            Pat::Id(_, span) => self.copy(src, Some(Place::new(*span))),
            Pat::Default(p, _) => self.bind_value(p, src),
            Pat::Obj { props, .. } => {
                for (key, p) in props {
                    self.bind_value(p, src.as_ref().map(|p| p.at(Step::Field(key.clone()))));
                }
            }
            Pat::Arr { elems, .. } => {
                for p in elems.iter().flatten() {
                    self.bind_value(p, src.as_ref().map(|p| p.at(Step::Index)));
                }
            }
        }
    }

    fn copy(&mut self, src: Option<Place>, dest: Option<Place>) {
        if let (Some(src), Some(dest)) = (src, dest) {
            self.copies.insert((src, dest));
        }
    }

    fn ident(&mut self, name: &str, names: &Names, env: &Rc<Scope>) -> Option<Place> {
        if let Some(p) = names.iter().rev().find_map(|s| s.get(name)) {
            return Some(p.clone());
        }
        match env.lookup(name)?.value {
            Value::Closure(c) => Some(self.function(&c.func, &[], &c.env)),
            _ => None,
        }
    }

    fn expr(&mut self, e: &Expr, names: &mut Names, env: &Rc<Scope>, owner: Span) -> Option<Place> {
        let value = Place::new(e.span);
        match &e.kind {
            ExprKind::Ident(name) => return self.ident(name, names, env),
            ExprKind::Func(f) => return Some(self.function(f, names, env)),
            ExprKind::Member { obj, prop, .. } => {
                return self
                    .expr(obj, names, env, owner)
                    .map(|p| p.at(Step::Field(prop.clone())));
            }
            ExprKind::Index { obj, index, .. } => {
                let obj = self.expr(obj, names, env, owner);
                self.expr(index, names, env, owner);
                let step = match &index.kind {
                    ExprKind::Str(key) => Step::Field(key.clone()),
                    _ => Step::Index,
                };
                return obj.map(|p| p.at(step));
            }
            ExprKind::NonNull(e) | ExprKind::As(e, _) | ExprKind::Chain(e) | ExprKind::Await(e) => {
                return self.expr(e, names, env, owner);
            }
            ExprKind::Update { target, .. } => {
                if let Some(p) = self.expr(target, names, env, owner) {
                    self.numeric.insert(p.clone());
                    self.events.entry(e.span).or_default().insert(p.clone());
                    self.function_numeric.entry(owner).or_default().insert(p.clone());
                    self.function_writes.entry(owner).or_default().insert(p);
                }
                self.history.entry(owner).or_default().insert(e.span);
            }
            ExprKind::Assign { target, value, op } => {
                let target = self.expr(target, names, env, owner);
                let src = self.expr(value, names, env, owner);
                if let Some(p) = &target {
                    self.function_writes.entry(owner).or_default().insert(p.clone());
                    if matches!(op, Some(AssignOp::Bin(_))) {
                        self.numeric.insert(p.clone());
                        self.events.entry(e.span).or_default().insert(p.clone());
                        self.function_numeric.entry(owner).or_default().insert(p.clone());
                    }
                }
                self.copy(src, target.clone());
                self.history.entry(owner).or_default().insert(e.span);
                return target;
            }
            ExprKind::Call { callee, args, .. } | ExprKind::New { callee, args } => {
                let callee_value = self.expr(callee, names, env, owner);
                let argv: Vec<_> = args
                    .iter()
                    .map(|a| {
                        let (ArrEl::Item(e) | ArrEl::Spread(e)) = a;
                        self.expr(e, names, env, owner)
                    })
                    .collect();
                if let ExprKind::Member { prop, .. } = &callee.kind {
                    // The receiver has already been visited above. Resolve its place without replaying effects.
                    let recv = callee_value.as_ref().and_then(|p| {
                        let mut p = p.clone();
                        p.path.pop()?;
                        Some(p)
                    });
                    if matches!(
                        prop.as_str(),
                        "push" | "pop" | "shift" | "unshift" | "splice" | "sort" | "reverse" | "fill"
                    ) && let Some(p) = &recv
                    {
                        self.function_writes.entry(owner).or_default().insert(p.at(Step::Index));
                    }
                    if matches!(prop.as_str(), "push" | "unshift" | "fill" | "splice")
                        && let Some(recv) = &recv
                    {
                        let inserted = if prop == "splice" {
                            &argv[argv.len().min(2)..]
                        } else if prop == "fill" {
                            &argv[..argv.len().min(1)]
                        } else {
                            &argv
                        };
                        for src in inserted {
                            self.copy(src.clone(), Some(recv.at(Step::Index)));
                        }
                    }
                    let element = recv.as_ref().map(|p| p.at(Step::Index));
                    let callback = match prop.as_str() {
                        "map" | "flatMap" => Some((0, vec![element.clone(), None], value.at(Step::Index))),
                        "forEach" | "filter" | "some" | "every" | "find" | "findLast" | "findIndex"
                        | "findLastIndex" => Some((0, vec![element.clone(), None], value.at(Step::Result))),
                        "reduce" => {
                            let acc = value.clone();
                            let initial = argv.get(1).cloned().flatten().or(element.clone());
                            self.copy(initial.clone(), Some(acc.clone()));
                            Some((0, vec![initial, element.clone(), None], acc))
                        }
                        "sort" | "toSorted" => {
                            Some((0, vec![element.clone(), element.clone()], value.at(Step::Result)))
                        }
                        "replace" | "replaceAll" => Some((1, vec![None; 5], value.at(Step::Result))),
                        "from"
                            if matches!(&callee.kind, ExprKind::Member { obj, .. }
                            if matches!(&obj.kind, ExprKind::Ident(n) if n == "Array")
                                && self.ident("Array", names, env).is_none()) =>
                        {
                            Some((
                                1,
                                vec![argv.first().cloned().flatten().map(|p| p.at(Step::Index)), None],
                                value.at(Step::Index),
                            ))
                        }
                        _ => None,
                    };
                    if let Some((index, args, result)) = callback
                        && let Some(Some(callback)) = argv.get(index)
                    {
                        if prop == "reduce" {
                            self.calls.push(Call {
                                callee: callback.clone(),
                                args: vec![Some(result.clone()), element.clone(), None],
                                result: result.clone(),
                                owner,
                                span: e.span,
                                prior: self
                                    .history
                                    .get(&owner)
                                    .into_iter()
                                    .flatten()
                                    .copied()
                                    .chain(std::iter::once(e.span))
                                    .collect(),
                            });
                        }
                        self.calls.push(Call {
                            callee: callback.clone(),
                            args,
                            result: result.clone(),
                            owner,
                            span: e.span,
                            prior: self
                                .history
                                .get(&owner)
                                .into_iter()
                                .flatten()
                                .copied()
                                .chain(std::iter::once(e.span))
                                .collect(),
                        });
                    }
                    match prop.as_str() {
                        "flatMap" => {
                            self.copy(Some(value.at(Step::Index).at(Step::Index)), Some(value.at(Step::Index)))
                        }
                        "filter" | "sort" | "toSorted" => self.copy(element, Some(value.at(Step::Index))),
                        "find" | "findLast" => self.copy(element, Some(value.clone())),
                        _ => {}
                    }
                }
                if let Some(callee) = callee_value {
                    self.calls.push(Call {
                        callee,
                        args: argv,
                        result: value.clone(),
                        owner,
                        span: e.span,
                        prior: self.history.get(&owner).cloned().unwrap_or_default(),
                    });
                }
                self.history.entry(owner).or_default().insert(e.span);
            }
            ExprKind::Array(items) => {
                for item in items {
                    let (ArrEl::Item(e) | ArrEl::Spread(e)) = item;
                    let src = self.expr(e, names, env, owner);
                    let src = if matches!(item, ArrEl::Spread(_)) {
                        src.map(|p| p.at(Step::Index))
                    } else {
                        src
                    };
                    self.copy(src, Some(value.at(Step::Index)));
                }
            }
            ExprKind::Object(props) => {
                for prop in props {
                    match prop {
                        Prop::KV(key, e) => {
                            let src = self.expr(e, names, env, owner);
                            let step = match key {
                                PropKey::Static(k) => Step::Field(k.clone()),
                                PropKey::Computed(e) => {
                                    self.expr(e, names, env, owner);
                                    Step::Index
                                }
                            };
                            self.copy(src, Some(value.at(step)));
                        }
                        Prop::Spread(e) => {
                            let src = self.expr(e, names, env, owner);
                            self.copy(src, Some(value.clone()));
                        }
                    }
                }
            }
            ExprKind::Cond(test, a, b) => {
                self.expr(test, names, env, owner);
                for e in [a, b] {
                    let src = self.expr(e, names, env, owner);
                    self.copy(src, Some(value.clone()));
                }
            }
            ExprKind::Logical(_, a, b) => {
                for e in [a, b] {
                    let src = self.expr(e, names, env, owner);
                    self.copy(src, Some(value.clone()));
                }
            }
            ExprKind::Binary(_, a, b) => {
                self.expr(a, names, env, owner);
                self.expr(b, names, env, owner);
            }
            ExprKind::Unary(_, e) | ExprKind::IsNullish(e, _) => {
                self.expr(e, names, env, owner);
            }
            ExprKind::Template(_, exprs) => {
                for e in exprs {
                    self.expr(e, names, env, owner);
                }
            }
            ExprKind::Num(_)
            | ExprKind::Str(_)
            | ExprKind::Bool(_)
            | ExprKind::Null
            | ExprKind::Undefined
            | ExprKind::Regex { .. } => {}
        }
        Some(value)
    }

    fn block(&mut self, body: &[Stmt], names: &mut Names, env: &Rc<Scope>, owner: Span) {
        names.push(HashMap::new());
        for s in body {
            match s {
                Stmt::Decl { pat, .. } => self.bind(pat, names, owner),
                Stmt::Func(f) => {
                    names
                        .last_mut()
                        .unwrap()
                        .insert(f.name.clone().unwrap(), Place::new(f.span));
                }
                _ => {}
            }
        }
        for s in body {
            self.stmt(s, names, env, owner);
        }
        names.pop();
    }

    fn stmt(&mut self, s: &Stmt, names: &mut Names, env: &Rc<Scope>, owner: Span) {
        match s {
            Stmt::Decl { pat, init, .. } => {
                let src = init.as_ref().and_then(|e| self.expr(e, names, env, owner));
                self.bind_value(pat, src);
                self.defaults(pat, names, env, owner);
            }
            Stmt::Func(f) => {
                self.function(f, names, env);
            }
            Stmt::Expr(e) | Stmt::Throw(e) | Stmt::ExportDefault(e) => {
                self.expr(e, names, env, owner);
            }
            Stmt::Return(Some(e), _) => {
                let src = self.expr(e, names, env, owner);
                self.copy(src, Some(Place::new(owner).at(Step::Result)));
            }
            Stmt::If(e, a, b) => {
                self.expr(e, names, env, owner);
                self.block(a, names, env, owner);
                if let Some(b) = b {
                    self.block(b, names, env, owner);
                }
            }
            Stmt::Block(b) => self.block(b, names, env, owner),
            Stmt::While(e, b) => {
                let first_call = self.calls.len();
                let before = self.history.get(&owner).cloned().unwrap_or_default();
                self.expr(e, names, env, owner);
                self.block(b, names, env, owner);
                self.loop_history(owner, first_call, &before);
            }
            Stmt::For {
                init,
                test,
                update,
                body,
                ..
            } => {
                names.push(HashMap::new());
                if let Some(init) = init {
                    if let Stmt::Decl { pat, .. } = init.as_ref() {
                        self.bind(pat, names, owner);
                    }
                    self.stmt(init, names, env, owner);
                }
                let first_call = self.calls.len();
                let before = self.history.get(&owner).cloned().unwrap_or_default();
                for e in [test, update].into_iter().flatten() {
                    self.expr(e, names, env, owner);
                }
                self.block(body, names, env, owner);
                self.loop_history(owner, first_call, &before);
                names.pop();
            }
            Stmt::ForOf { pat, iter, body, .. } => {
                let src = self.expr(iter, names, env, owner).map(|p| p.at(Step::Index));
                let first_call = self.calls.len();
                let before = self.history.get(&owner).cloned().unwrap_or_default();
                names.push(HashMap::new());
                self.bind(pat, names, owner);
                self.bind_value(pat, src);
                self.defaults(pat, names, env, owner);
                self.block(body, names, env, owner);
                self.loop_history(owner, first_call, &before);
                names.pop();
            }
            Stmt::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                self.block(block, names, env, owner);
                if let Some(body) = handler {
                    names.push(HashMap::new());
                    if let Some((name, span)) = param {
                        names.last_mut().unwrap().insert(name.clone(), Place::new(*span));
                    }
                    self.block(body, names, env, owner);
                    names.pop();
                }
                if let Some(body) = finalizer {
                    self.block(body, names, env, owner);
                }
            }
            Stmt::Switch { disc, cases, .. } => {
                self.expr(disc, names, env, owner);
                for (e, body) in cases {
                    if let Some(e) = e {
                        self.expr(e, names, env, owner);
                    }
                    self.block(body, names, env, owner);
                }
            }
            Stmt::Exported(s) => self.stmt(s, names, env, owner),
            Stmt::Return(None, _)
            | Stmt::Break(_)
            | Stmt::Continue(_)
            | Stmt::TypeAlias { .. }
            | Stmt::Import { .. }
            | Stmt::ExportNames { .. }
            | Stmt::ExportAll { .. } => {}
        }
    }

    fn bounded(&self, mut p: Place) -> Place {
        if p.path.len() > self.max_depth {
            p.path.truncate(self.max_depth);
            p.path.push(Step::Descendants);
        }
        p
    }

    fn loop_history(&mut self, owner: Span, first_call: usize, before: &HashSet<Span>) {
        let events: HashSet<_> = self
            .history
            .get(&owner)
            .into_iter()
            .flat_map(|events| events.difference(before).copied())
            .collect();
        for call in &mut self.calls[first_call..] {
            if call.owner == owner {
                call.prior.extend(&events);
            }
        }
    }

    fn solve(mut self) -> Effects {
        self.max_depth = self
            .copies
            .iter()
            .flat_map(|(a, b)| [a.path.len(), b.path.len()])
            .chain(self.numeric.iter().map(|p| p.path.len()))
            .max()
            .unwrap_or(0)
            + 1;
        loop {
            let before = (
                self.reachable.len(),
                self.incoming.len(),
                self.values.len(),
                self.copies.len(),
                self.numeric.len(),
                self.writes.len(),
                self.function_numeric.values().map(HashSet::len).sum::<usize>(),
                self.function_writes.values().map(HashSet::len).sum::<usize>(),
                self.events.values().map(HashSet::len).sum::<usize>(),
            );
            for call in &self.calls {
                if !self.reachable.contains(&call.owner) {
                    continue;
                }
                for (_, function) in self.values.iter().filter(|(value, _)| value == &call.callee) {
                    self.reachable.insert(*function);
                    let params = &self.functions[function];
                    for (arg, param) in call.args.iter().zip(params) {
                        if let (Some(arg), Some(param)) = (arg, param) {
                            self.copies.insert((arg.clone(), param.clone()));
                        }
                    }
                    self.copies
                        .insert((Place::new(*function).at(Step::Result), call.result.clone()));
                }
            }
            let values: Vec<_> = self.values.iter().cloned().collect();
            for (src, dest) in &self.copies {
                for (value, function) in &values {
                    if value.binding == src.binding && value.path.starts_with(&src.path) {
                        let mut target = dest.clone();
                        target.path.extend_from_slice(&value.path[src.path.len()..]);
                        self.values.insert((self.bounded(target), *function));
                    }
                }
            }
            self.numeric = self
                .function_numeric
                .iter()
                .filter(|(owner, _)| self.reachable.contains(owner))
                .flat_map(|(_, paths)| paths.iter().cloned())
                .chain(self.incoming.iter().cloned())
                .collect();
            self.writes = self
                .function_writes
                .iter()
                .filter(|(owner, _)| self.reachable.contains(owner))
                .flat_map(|(_, paths)| paths.iter().cloned())
                .collect();
            for call in &self.calls {
                if !self.reachable.contains(&call.owner) {
                    continue;
                }
                for (_, function) in self.values.iter().filter(|(value, _)| value == &call.callee) {
                    for (arg, param) in call.args.iter().zip(&self.functions[function]) {
                        let (Some(arg), Some(param)) = (arg, param) else {
                            continue;
                        };
                        // Use writes that can precede this call, rather than
                        // later writes elsewhere in the caller. Captures keep
                        // their stable view because closures can run later.
                        let captures = self.bindings.get(&arg.binding) != Some(&call.owner);
                        let prior = call.prior.iter().filter_map(|event| self.events.get(event)).flatten();
                        let inputs = self
                            .incoming
                            .iter()
                            .chain(prior)
                            .chain(self.numeric.iter().filter(|_| captures));
                        let mut incoming = Vec::new();
                        for p in inputs {
                            if p.binding == arg.binding && p.path.starts_with(&arg.path) {
                                let mut target = param.clone();
                                target.path.extend_from_slice(&p.path[arg.path.len()..]);
                                incoming.push(self.bounded(target));
                            }
                        }
                        self.incoming.extend(incoming);
                    }
                    let summary = self.function_numeric.get(function).cloned().unwrap_or_default();
                    for p in summary {
                        let param = self.functions[function]
                            .iter()
                            .position(|param| param.as_ref().is_some_and(|param| param.binding == p.binding));
                        let target = if let Some(i) = param {
                            if p.path.is_empty() {
                                continue;
                            }
                            let Some(Some(arg)) = call.args.get(i) else {
                                continue;
                            };
                            let mut target = arg.clone();
                            target.path.extend_from_slice(&p.path);
                            self.bounded(target)
                        } else if self.bindings.get(&p.binding) != Some(function) {
                            p
                        } else {
                            continue;
                        };
                        self.events.entry(call.span).or_default().insert(target.clone());
                        self.function_numeric
                            .entry(call.owner)
                            .or_default()
                            .insert(target.clone());
                        self.numeric.insert(target);
                    }
                    for (arg, param) in call.args.iter().zip(&self.functions[function]) {
                        let (Some(arg), Some(param)) = (arg, param) else {
                            continue;
                        };
                        let propagated: Vec<_> = self
                            .writes
                            .iter()
                            .filter(|p| p.binding == param.binding && !p.path.is_empty())
                            .map(|p| {
                                let mut target = arg.clone();
                                target.path.extend_from_slice(&p.path);
                                self.bounded(target)
                            })
                            .collect();
                        self.writes.extend(propagated.iter().cloned());
                        self.function_writes.entry(call.owner).or_default().extend(propagated);
                    }
                }
            }
            if before
                == (
                    self.reachable.len(),
                    self.incoming.len(),
                    self.values.len(),
                    self.copies.len(),
                    self.numeric.len(),
                    self.writes.len(),
                    self.function_numeric.values().map(HashSet::len).sum::<usize>(),
                    self.function_writes.values().map(HashSet::len).sum::<usize>(),
                    self.events.values().map(HashSet::len).sum::<usize>(),
                )
            {
                break;
            }
        }
        let mut effects = Effects {
            numeric: HashMap::new(),
            incoming: HashMap::new(),
            writes: self.writes,
            events: self.events,
        };
        for p in self.numeric {
            effects.numeric.entry(p.binding).or_default().insert(p.path);
        }
        for p in self.incoming {
            effects.incoming.entry(p.binding).or_default().insert(p.path);
        }
        effects
    }
}
