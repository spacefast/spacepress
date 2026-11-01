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

/// An indexed read can select a named object property as well as an array
/// element. Keep the remainder so container operations preserve nested values.
fn projected_suffix<'a>(path: &'a [Step], prefix: &[Step]) -> Option<&'a [Step]> {
    for (i, step) in prefix.iter().enumerate() {
        if matches!(step, Step::Descendants) {
            return Some(&[]);
        }
        let actual = path.get(i)?;
        if actual != step
            && !matches!(
                (actual, step),
                (Step::Field(_), Step::Index) | (Step::Index, Step::Field(_))
            )
        {
            return None;
        }
    }
    path.get(prefix.len()..)
}

/// A synthetic span standing for the module value `name` (distinct from every source span).
fn external_span(name: &str) -> Span {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    name.hash(&mut h);
    let v = h.finish();
    Span {
        file: crate::diag::NO_FILE - 1,
        start: v as u32,
        end: (v >> 32) as u32,
    }
}

fn callable_at(value: &Place, callee: &Place) -> bool {
    value.binding == callee.binding && projected_suffix(&value.path, &callee.path).is_some_and(<[Step]>::is_empty)
}

#[derive(Default)]
pub(super) struct Effects {
    captured: HashSet<Span>,
    numeric: HashMap<Span, HashSet<Vec<Step>>>,
    incoming: HashMap<Span, HashSet<Vec<Step>>>,
    incoming_writes: HashMap<Span, HashSet<Vec<Step>>>,
    writes: HashSet<Place>,
    parameters: HashSet<Span>,
    capture_writes: HashMap<Span, HashSet<Place>>,
    events: HashMap<Span, HashSet<Place>>,
    write_events: HashMap<Span, HashSet<Place>>,
    expression_writes: HashMap<Span, HashSet<Place>>,
    expression_places: HashMap<Span, Place>,
    loop_writes: HashMap<Span, HashSet<Place>>,
    reference_arguments: HashMap<Span, HashSet<usize>>,
    /// Calls whose callee resolved to known functions, and the argument positions whose value the
    /// callee may keep past the call (returns it, stores it outside its own locals, or passes it on
    /// to a parameter that does).
    resolved_calls: HashSet<Span>,
    retained_arguments: HashMap<Span, HashSet<usize>>,
    /// (call, argument, through a callback) → the deepest path the callee writes below that parameter.
    write_depths: HashMap<(Span, usize, bool), usize>,
    /// Calls to a function whose result may be a container someone else holds.
    shared_calls: HashSet<Span>,
    /// (call, argument) where the callee stores some value inside that parameter.
    stores_into: HashSet<(Span, usize)>,
    /// (call, argument) the callee keeps somewhere beyond its result.
    stored_arguments: HashSet<(Span, usize)>,
    /// (call, argument) whose member the callee keeps somewhere beyond its result.
    stored_members: HashSet<(Span, usize)>,
    /// (call, argument) a member of which the callee may return.
    returned_members: HashSet<(Span, usize)>,
    /// Call → bindings of enclosing functions the callee writes into, with the deepest write.
    captured_writes: HashMap<Span, HashMap<Span, usize>>,
}

impl Effects {
    pub fn captured(&self, binding: Span) -> bool {
        self.captured.contains(&binding)
    }

    pub fn analyze(roots: &[Root]) -> Self {
        let mut graph = Graph::default();
        for root in roots {
            graph.function(&root.closure.func, &[], &root.closure.env);
            graph.reachable.insert(root.closure.func.span);
            graph.roots.insert(root.closure.func.span);
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

    /// Keep authored parameter constraints separate from numeric values and
    /// tuple positions changed by the caller before invoking us.
    pub fn parameter_type(&self, binding: Span, ty: &Ty) -> Ty {
        let ty = self.incoming_writes.get(&binding).map_or_else(
            || ty.clone(),
            |paths| paths.iter().fold(ty.clone(), |ty, path| restore(&ty, &ty, path)),
        );
        self.incoming.get(&binding).map_or_else(
            || ty.clone(),
            |paths| paths.iter().fold(ty.clone(), |ty, path| widen(&ty, path)),
        )
    }

    pub fn by_ref(&self, pat: &Pat) -> bool {
        matches!(pat, Pat::Id(_, span) if self.writes.iter().any(|p| p.binding == *span && !p.path.is_empty()))
    }

    pub fn shared_parameter(&self, binding: Span) -> bool {
        self.parameters.contains(&binding) && self.writes.iter().any(|p| p.binding == binding && !p.path.is_empty())
    }

    /// A write invalidates refinements of that location and its descendants.
    /// Sibling refinements and the authored assignment constraint remain intact.
    pub fn invalidate(&self, event: Span, binding: Span, view: &[Step], ty: &Ty, constraint: &Ty) -> Ty {
        self.write_events.get(&event).map_or_else(
            || ty.clone(),
            |paths| invalidate_paths(paths, binding, view, ty, constraint),
        )
    }

    pub fn invalidate_loop(&self, event: Span, binding: Span, view: &[Step], ty: &Ty, constraint: &Ty) -> Ty {
        self.loop_writes.get(&event).map_or_else(
            || ty.clone(),
            |paths| invalidate_paths(paths, binding, view, ty, constraint),
        )
    }

    pub fn changes_refinement(&self, expression: Span, binding: Span, view: &[Step]) -> bool {
        self.expression_writes.get(&expression).is_some_and(|writes| {
            writes.iter().any(|p| {
                p.binding == binding
                    && (projected_suffix(&p.path, view).is_some() || projected_suffix(view, &p.path).is_some())
            })
        })
    }

    pub fn argument_by_ref(&self, call: Span, index: usize) -> bool {
        self.reference_arguments
            .get(&call)
            .is_some_and(|arguments| arguments.contains(&index))
    }

    /// Whether the call's callee is a function of this program (not a runtime API or a builtin).
    pub fn resolved(&self, call: Span) -> bool {
        self.resolved_calls.contains(&call)
    }

    /// Whether the callee may return the argument itself.
    pub fn argument_retained(&self, call: Span, index: usize) -> bool {
        self.retained_arguments
            .get(&call)
            .is_some_and(|arguments| arguments.contains(&index))
    }

    /// How deep below the argument the callee writes (1 = a member of it), if it writes at all.
    pub fn argument_write_depth(&self, call: Span, index: usize) -> Option<usize> {
        self.write_depths.get(&(call, index, false)).copied()
    }

    /// For an array method given a function: how deep the function writes below its parameter
    /// `index` (the element, for most methods), if it writes at all.
    pub fn callback_write_depth(&self, call: Span, index: usize) -> Option<usize> {
        self.write_depths.get(&(call, index, true)).copied()
    }

    /// Whether the callee keeps the argument somewhere other than its result.
    pub fn argument_stored(&self, call: Span, index: usize) -> bool {
        self.stored_arguments.contains(&(call, index))
    }

    /// Whether the callee keeps a member of the argument somewhere other than its result.
    pub fn argument_member_stored(&self, call: Span, index: usize) -> bool {
        self.stored_members.contains(&(call, index))
    }

    /// Bindings of enclosing functions the callee writes into (through a capture).
    pub fn captured_writes(&self, call: Span) -> impl Iterator<Item = (Span, usize)> + '_ {
        self.captured_writes
            .get(&call)
            .into_iter()
            .flatten()
            .map(|(b, d)| (*b, *d))
    }

    /// Whether the callee may return a member of the argument.
    pub fn argument_member_returned(&self, call: Span, index: usize) -> bool {
        self.returned_members.contains(&(call, index))
    }

    /// Whether the callee stores a value somewhere inside that argument.
    pub fn stores_into_argument(&self, call: Span, index: usize) -> bool {
        self.stores_into.contains(&(call, index))
    }

    /// Whether the call's result may be a container another value holds.
    pub fn result_shared(&self, call: Span) -> bool {
        self.shared_calls.contains(&call)
    }

    pub fn replaces_argument(&self, argument: Span, later: Span) -> bool {
        let Some(argument) = self.expression_places.get(&argument) else {
            return false;
        };
        self.expression_writes.get(&later).is_some_and(|writes| {
            writes
                .iter()
                .any(|p| p.binding == argument.binding && projected_suffix(&argument.path, &p.path).is_some())
        })
    }

    pub fn capture_type(&self, function: Span, binding: Span, view: &[Step], ty: &Ty, constraint: &Ty) -> Ty {
        let ty = self.capture_writes.get(&function).map_or_else(
            || ty.clone(),
            |paths| invalidate_paths(paths, binding, view, ty, constraint),
        );
        self.read_view_type(binding, view, &ty)
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

fn invalidate_paths(paths: &HashSet<Place>, binding: Span, view: &[Step], ty: &Ty, constraint: &Ty) -> Ty {
    paths.iter().filter(|p| p.binding == binding).fold(ty.clone(), |ty, p| {
        if let Some(path) = projected_suffix(&p.path, view) {
            restore(&ty, constraint, path)
        } else if projected_suffix(view, &p.path).is_some() {
            constraint.clone()
        } else {
            ty
        }
    })
}

fn restore(ty: &Ty, constraint: &Ty, path: &[Step]) -> Ty {
    let Some((step, rest)) = path.split_first() else {
        return constraint.clone();
    };
    match (ty, step) {
        (Ty::Union(ts), _) => Ty::union(ts.iter().map(|t| restore(t, constraint, path))),
        (_, Step::Descendants) => constraint.clone(),
        (Ty::Obj(fields), Step::Field(field)) => {
            let mut fields = fields.clone();
            if let Some((ty, _)) = fields.get_mut(field)
                && let Some((original, _)) = constraint.non_null().field(field)
            {
                *ty = restore(ty, &original, rest);
            }
            Ty::Obj(fields)
        }
        (Ty::Obj(fields), Step::Index) => Ty::Obj(
            fields
                .iter()
                .map(|(key, (ty, optional))| {
                    let original = constraint
                        .non_null()
                        .field(key)
                        .map(|(t, _)| t)
                        .unwrap_or_else(|| ty.clone());
                    (key.clone(), (restore(ty, &original, rest), *optional))
                })
                .collect(),
        ),
        (Ty::Array(t), Step::Index) => match constraint.non_null() {
            Ty::Array(original) => Ty::Array(Box::new(restore(t, &original, rest))),
            _ => ty.clone(),
        },
        (Ty::Map(t), _) => match constraint.non_null() {
            Ty::Map(original) => Ty::Map(Box::new(restore(t, &original, rest))),
            _ => ty.clone(),
        },
        (Ty::Tuple(ts), Step::Index) | (Ty::ArrayLiteral(ts), Step::Index) => {
            let original = match constraint.non_null() {
                Ty::Tuple(ts) | Ty::ArrayLiteral(ts) => ts,
                _ => return ty.clone(),
            };
            if rest.is_empty() {
                // Mutators can reorder, replace, grow or shrink a tuple. Its
                // read view becomes an array; authored constraints stay fixed.
                return Ty::Array(Box::new(Ty::union(ts.iter().chain(&original).cloned())));
            }
            let values = ts.iter().zip(&original).map(|(t, c)| restore(t, c, rest)).collect();
            if matches!(ty, Ty::Tuple(_)) {
                Ty::Tuple(values)
            } else {
                Ty::ArrayLiteral(values)
            }
        }
        _ => ty.clone(),
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

/// How a function keeps a parameter past the call: stored whole / a member stored elsewhere,
/// returned whole / a member returned.
struct Kept {
    whole: bool,
    part: bool,
    returned: bool,
    returned_part: bool,
}

struct Call {
    /// A callback an array method calls with its elements (not a call written in the program).
    callback: bool,
    callee: Place,
    args: Vec<Option<Place>>,
    result: Place,
    owner: Span,
    span: Span,
    prior: HashSet<Span>,
}

#[derive(Default)]
struct Graph {
    captured: HashSet<Span>,
    /// Captured binding → the functions that read it from an enclosing scope.
    captured_by: HashMap<Span, HashSet<Span>>,
    /// Module-level containers read by functions: a stable synthetic binding per module value.
    externals: HashSet<Span>,
    roots: HashSet<Span>,
    reachable: HashSet<Span>,
    incoming: HashSet<Place>,
    incoming_writes: HashSet<Place>,
    history: HashMap<Span, HashSet<Span>>,
    created_prior: HashMap<Span, HashSet<Span>>,
    created_by: HashMap<Span, Span>,
    expression_events: HashMap<Span, HashSet<Span>>,
    expression_places: HashMap<Span, Place>,
    loop_events: HashMap<Span, HashSet<Span>>,
    functions: HashMap<Span, Vec<Place>>,
    values: HashSet<(Place, Span)>,
    copies: HashSet<(Place, Place, Span)>,
    calls: Vec<Call>,
    numeric: HashSet<Place>,
    writes: HashSet<Place>,
    max_depth: usize,
    bindings: HashMap<Span, Span>,
    parameter_views: HashMap<Span, Place>,
    function_numeric: HashMap<Span, HashSet<Place>>,
    function_writes: HashMap<Span, HashSet<Place>>,
    events: HashMap<Span, HashSet<Place>>,
    write_events: HashMap<Span, HashSet<Place>>,
}

type Names = Vec<HashMap<String, Place>>;

impl Graph {
    fn function(&mut self, f: &Rc<Func>, outer: &[HashMap<String, Place>], env: &Rc<Scope>) -> Place {
        let owner = f.span;
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
                let param = Place::new(p.pat.span());
                self.bindings.insert(param.binding, owner);
                self.bind_value(&p.pat, Some(param.clone()), owner);
                self.parameter_pattern(&p.pat, &param);
                param
            })
            .collect();
        self.functions.insert(f.span, params);
        for p in &f.params {
            self.defaults(&p.pat, &mut names, env, f.span);
            if let Some(e) = &p.default {
                let default = self.expr(e, &mut names, env, f.span);
                self.bind_value(&p.pat, default, owner);
            }
        }
        match &f.body {
            FnBody::Expr(e) => {
                let result = self.expr(e, &mut names, env, f.span);
                self.copy(result, Some(value.at(Step::Result)), owner);
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
                self.bind_value(p, value, owner);
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

    fn bind_value(&mut self, pat: &Pat, src: Option<Place>, owner: Span) {
        match pat {
            Pat::Id(_, span) => self.copy(src, Some(Place::new(*span)), owner),
            Pat::Default(p, _) => self.bind_value(p, src, owner),
            Pat::Obj { props, rest, .. } => {
                for (key, p) in props {
                    self.bind_value(p, src.as_ref().map(|p| p.at(Step::Field(key.clone()))), owner);
                }
                if let Some((_, span)) = rest {
                    self.copy(src, Some(Place::new(*span)), owner);
                }
            }
            Pat::Arr { elems, rest, .. } => {
                for p in elems.iter().flatten() {
                    self.bind_value(p, src.as_ref().map(|p| p.at(Step::Index)), owner);
                }
                if let Some((_, span)) = rest {
                    self.copy(src, Some(Place::new(*span)), owner);
                }
            }
        }
    }

    fn parameter_pattern(&mut self, pat: &Pat, src: &Place) {
        match pat {
            Pat::Id(_, span) => {
                if *span != src.binding {
                    self.parameter_views.insert(*span, src.clone());
                }
            }
            Pat::Default(p, _) => self.parameter_pattern(p, src),
            Pat::Obj { props, rest, .. } => {
                for (key, p) in props {
                    self.parameter_pattern(p, &src.at(Step::Field(key.clone())));
                }
                if let Some((_, span)) = rest {
                    self.parameter_views.insert(*span, src.clone());
                }
            }
            Pat::Arr { elems, rest, .. } => {
                for p in elems.iter().flatten() {
                    self.parameter_pattern(p, &src.at(Step::Index));
                }
                if let Some((_, span)) = rest {
                    self.parameter_views.insert(*span, src.clone());
                }
            }
        }
    }

    fn copy(&mut self, src: Option<Place>, dest: Option<Place>, owner: Span) {
        if let (Some(src), Some(dest)) = (src, dest) {
            self.copies.insert((src, dest, owner));
        }
    }

    fn ident(&mut self, name: &str, names: &Names, env: &Rc<Scope>) -> Option<Place> {
        if let Some(p) = names.iter().rev().find_map(|s| s.get(name)) {
            return Some(p.clone());
        }
        match env.lookup(name)?.value {
            Value::Closure(c) => Some(self.function(&c.func, &[], &c.env)),
            // A module container: one external place per name, shared by every function.
            Value::Array(_) | Value::Object(_) => {
                let span = external_span(name);
                self.externals.insert(span);
                Some(Place::new(span))
            }
            _ => None,
        }
    }

    fn expr(&mut self, e: &Expr, names: &mut Names, env: &Rc<Scope>, owner: Span) -> Option<Place> {
        let before = self.history.get(&owner).cloned().unwrap_or_default();
        let result = self.expr_inner(e, names, env, owner);
        let events = self
            .history
            .get(&owner)
            .into_iter()
            .flat_map(|events| events.difference(&before).copied())
            .collect();
        self.expression_events.insert(e.span, events);
        if let Some(place) = &result {
            self.expression_places.insert(e.span, place.clone());
        }
        result
    }

    fn expr_inner(&mut self, e: &Expr, names: &mut Names, env: &Rc<Scope>, owner: Span) -> Option<Place> {
        let value = Place::new(e.span);
        match &e.kind {
            ExprKind::Ident(name) => {
                let place = self.ident(name, names, env)?;
                if self
                    .bindings
                    .get(&place.binding)
                    .is_some_and(|binding_owner| *binding_owner != owner)
                {
                    self.captured.insert(place.binding);
                    self.captured_by.entry(place.binding).or_default().insert(owner);
                }
                return Some(place);
            }
            ExprKind::Func(f) => {
                self.created_by.insert(f.span, owner);
                self.created_prior
                    .entry(f.span)
                    .or_insert_with(|| self.history.get(&owner).cloned().unwrap_or_default());
                return Some(self.function(f, names, env));
            }
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
                    self.write_events.entry(e.span).or_default().insert(p.clone());
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
                    self.write_events.entry(e.span).or_default().insert(p.clone());
                    self.function_writes.entry(owner).or_default().insert(p.clone());
                    if matches!(op, Some(AssignOp::Bin(_))) {
                        self.numeric.insert(p.clone());
                        self.events.entry(e.span).or_default().insert(p.clone());
                        self.function_numeric.entry(owner).or_default().insert(p.clone());
                    }
                }
                self.copy(src, target.clone(), owner);
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
                        let target = p.at(Step::Index);
                        self.write_events.entry(e.span).or_default().insert(target.clone());
                        self.function_writes.entry(owner).or_default().insert(target);
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
                            self.copy(src.clone(), Some(recv.at(Step::Index)), owner);
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
                            self.copy(initial.clone(), Some(acc.clone()), owner);
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
                                callback: true,
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
                            callback: true,
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
                        "flatMap" => self.copy(
                            Some(value.at(Step::Index).at(Step::Index)),
                            Some(value.at(Step::Index)),
                            owner,
                        ),
                        "filter" | "sort" | "toSorted" | "reverse" | "toReversed" | "slice" | "splice" | "fill" => {
                            self.copy(element, Some(value.at(Step::Index)), owner)
                        }
                        "find" | "findLast" | "at" | "pop" | "shift" => self.copy(element, Some(value.clone()), owner),
                        "concat" => {
                            self.copy(element, Some(value.at(Step::Index)), owner);
                            for arg in &argv {
                                self.copy(arg.clone(), Some(value.at(Step::Index)), owner);
                                self.copy(
                                    arg.as_ref().map(|p| p.at(Step::Index)),
                                    Some(value.at(Step::Index)),
                                    owner,
                                );
                            }
                        }
                        "flat" => {
                            self.copy(element, Some(value.at(Step::Index)), owner);
                            let depth = match args.first() {
                                None => Some(1),
                                Some(ArrEl::Item(Expr {
                                    kind: ExprKind::Num(n), ..
                                })) => Some(n.max(0.0) as usize),
                                _ => None,
                            };
                            if let Some(mut src) = recv.clone() {
                                if let Some(depth @ 0..=1) = depth {
                                    for _ in 0..=depth {
                                        src = src.at(Step::Index);
                                    }
                                } else {
                                    src = src.at(Step::Descendants);
                                }
                                self.copy(Some(src), Some(value.at(Step::Index)), owner);
                            }
                        }
                        _ => {}
                    }
                    if let ExprKind::Member { obj, .. } = &callee.kind
                        && let ExprKind::Ident(global) = &obj.kind
                        && self.ident(global, names, env).is_none()
                    {
                        let source = argv.first().cloned().flatten();
                        match (global.as_str(), prop.as_str()) {
                            ("Array", "from") if argv.len() == 1 => self.copy(source, Some(value.clone()), owner),
                            ("Object", "values") => {
                                self.copy(source.map(|p| p.at(Step::Index)), Some(value.at(Step::Index)), owner)
                            }
                            ("Object", "entries") => self.copy(
                                source.map(|p| p.at(Step::Index)),
                                Some(value.at(Step::Index).at(Step::Index)),
                                owner,
                            ),
                            ("Object", "fromEntries") => self.copy(
                                source.map(|p| p.at(Step::Index).at(Step::Index)),
                                Some(value.at(Step::Index)),
                                owner,
                            ),
                            _ => {}
                        }
                    }
                }
                if let Some(callee) = callee_value {
                    self.calls.push(Call {
                        callback: false,
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
                    self.copy(src, Some(value.at(Step::Index)), owner);
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
                            self.copy(src, Some(value.at(step)), owner);
                        }
                        Prop::Spread(e) => {
                            let src = self.expr(e, names, env, owner);
                            self.copy(src, Some(value.clone()), owner);
                        }
                    }
                }
            }
            ExprKind::Cond(test, a, b) => {
                self.expr(test, names, env, owner);
                for e in [a, b] {
                    let src = self.expr(e, names, env, owner);
                    self.copy(src, Some(value.clone()), owner);
                }
            }
            ExprKind::Logical(_, a, b) => {
                for e in [a, b] {
                    let src = self.expr(e, names, env, owner);
                    self.copy(src, Some(value.clone()), owner);
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
                self.bind_value(pat, src, owner);
                self.defaults(pat, names, env, owner);
            }
            Stmt::Func(f) => {
                self.created_by.insert(f.span, owner);
                self.created_prior
                    .entry(f.span)
                    .or_insert_with(|| self.history.get(&owner).cloned().unwrap_or_default());
                self.function(f, names, env);
            }
            Stmt::Expr(e) | Stmt::Throw(e) | Stmt::ExportDefault(e) => {
                self.expr(e, names, env, owner);
            }
            Stmt::Return(Some(e), _) => {
                let src = self.expr(e, names, env, owner);
                self.copy(src, Some(Place::new(owner).at(Step::Result)), owner);
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
                self.loop_history(owner, first_call, &before, e.span);
            }
            Stmt::For {
                init,
                test,
                update,
                body,
                span,
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
                self.loop_history(owner, first_call, &before, *span);
                names.pop();
            }
            Stmt::ForOf {
                pat, iter, body, span, ..
            } => {
                let src = self.expr(iter, names, env, owner).map(|p| p.at(Step::Index));
                let first_call = self.calls.len();
                let before = self.history.get(&owner).cloned().unwrap_or_default();
                names.push(HashMap::new());
                self.bind(pat, names, owner);
                self.bind_value(pat, src, owner);
                self.defaults(pat, names, env, owner);
                self.block(body, names, env, owner);
                self.loop_history(owner, first_call, &before, *span);
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

    fn loop_history(&mut self, owner: Span, first_call: usize, before: &HashSet<Span>, key: Span) {
        let events: HashSet<_> = self
            .history
            .get(&owner)
            .into_iter()
            .flat_map(|events| events.difference(before).copied())
            .collect();
        self.loop_events.insert(key, events.clone());
        for call in &mut self.calls[first_call..] {
            if call.owner == owner {
                call.prior.extend(&events);
            }
        }
    }

    /// Where each place's value ends up beyond plain locals: a function's result, or a binding of
    /// some function. From that: which parameters a function keeps past the call (returns them or
    /// stores them where its caller can see them), and which functions may return a container that
    /// another value holds (a parameter, a captured binding, the shared result of another call).
    fn retention(&self) -> (HashMap<Span, Kept>, HashSet<Span>) {
        #[derive(Clone, Copy, PartialEq, Eq, Hash)]
        enum Sink {
            Result(Span),
            /// Stored into a binding of this function.
            Store(Span),
            /// Stored into a parameter's container (its caller holds that).
            IntoParam,
        }
        let parameters: HashMap<Span, Span> = self
            .functions
            .iter()
            .flat_map(|(f, ps)| ps.iter().map(move |p| (p.binding, *f)))
            .collect();
        let owner_of = |b: &Span, edge: &Span| {
            parameters
                .get(b)
                .or_else(|| self.bindings.get(b))
                .copied()
                .unwrap_or(*edge)
        };
        let is_binding = |b: &Span| parameters.contains_key(b) || self.bindings.contains_key(b);
        let encloses = |outer: Span, inner: Span| {
            let mut cur = self.created_by.get(&inner).copied();
            while let Some(f) = cur {
                if f == outer {
                    return true;
                }
                cur = self.created_by.get(&f).copied();
            }
            false
        };
        // Each binding → where its value goes, and whether only a member of it does (`.1`):
        // `list.push(o.count)` keeps a member of `o`, not `o`.
        let mut sinks: HashMap<Span, HashSet<(Sink, bool)>> = HashMap::new();
        // Function → the places its result is copied into (call results).
        let mut result_into: HashMap<Span, Vec<(Place, Span)>> = HashMap::new();
        for (src, dest, edge) in &self.copies {
            if self.functions.contains_key(&src.binding) && src.path.first() == Some(&Step::Result) {
                result_into.entry(src.binding).or_default().push((dest.clone(), *edge));
            }
        }
        // Where a value flowing into `dest` ends up (one step).
        let step = |sinks: &HashMap<Span, HashSet<(Sink, bool)>>, dest: &Place, edge: &Span, member: bool| {
            let mut add: HashSet<(Sink, bool)> = if self.functions.contains_key(&dest.binding) {
                HashSet::new()
            } else {
                sinks
                    .get(&dest.binding)
                    .into_iter()
                    .flatten()
                    // `member`: only part of the source flows on. Storing the source inside a
                    // member of `dest` keeps the whole source.
                    .map(|(s, m)| (*s, *m || member))
                    .collect()
            };
            if self.functions.contains_key(&dest.binding) {
                if dest.path.first() == Some(&Step::Result) {
                    add.insert((Sink::Result(dest.binding), member));
                }
            } else if parameters.contains_key(&dest.binding) {
                // An argument: wherever that parameter ends up. Stored inside it: its caller
                // holds the container it went into.
                if !dest.path.is_empty() {
                    add.insert((Sink::IntoParam, member));
                }
            } else if is_binding(&dest.binding) || self.externals.contains(&dest.binding) {
                add.insert((Sink::Store(owner_of(&dest.binding, edge)), member));
            }
            add
        };
        loop {
            let mut changed = false;
            for (src, dest, edge) in &self.copies {
                if src.binding == dest.binding
                    || matches!(src.path.last(), Some(Step::Field(f)) if f == "length")
                    || self.functions.contains_key(&src.binding)
                {
                    continue;
                }
                let member = !src.path.is_empty();
                let add = step(&sinks, dest, edge, member);
                let entry = sinks.entry(src.binding).or_default();
                let before = entry.len();
                entry.extend(add);
                changed |= entry.len() != before;
            }
            // A function's result flows into its call sites' result places: whatever returned
            // into it (a parameter, a captured binding) flows on from there too.
            let returned: Vec<(Span, Span, bool)> = sinks
                .iter()
                .flat_map(|(b, ss)| {
                    ss.iter().filter_map(move |(s, m)| match s {
                        Sink::Result(f) => Some((*b, *f, *m)),
                        _ => None,
                    })
                })
                .collect();
            for (b, f, m) in returned {
                for (dest, edge) in result_into.get(&f).into_iter().flatten() {
                    let add = step(&sinks, dest, edge, m);
                    let entry = sinks.entry(b).or_default();
                    let before = entry.len();
                    entry.extend(add);
                    changed |= entry.len() != before;
                }
            }
            // A closure that captures a binding keeps it: wherever the closure value goes, the
            // binding goes too (a member of whatever holds the closure).
            let captures: Vec<(Span, Span)> = self
                .captured_by
                .iter()
                .flat_map(|(b, fs)| fs.iter().map(move |f| (*b, *f)))
                .collect();
            for (b, f) in captures {
                let closure_sinks: Vec<(Sink, bool)> = self
                    .copies
                    .iter()
                    .filter(|(src, dest, _)| src.binding == f && src.path.is_empty() && dest.binding != f)
                    .flat_map(|(_, dest, edge)| step(&sinks, dest, edge, true))
                    .collect();
                let entry = sinks.entry(b).or_default();
                let before = entry.len();
                entry.extend(closure_sinks);
                changed |= entry.len() != before;
            }
            if !changed {
                break;
            }
        }
        // Per parameter: (stored whole, stored a member). Returning counts as retaining (the
        // caller decides by the result's type whether that matters).
        // Whether a value placed at `dest` leaves `function`: returned from it or stored beyond it.
        fn sinks_of_value(
            sinks: &HashMap<Span, HashSet<(Sink, bool)>>,
            dest: &Place,
            function: &Span,
            store: &dyn Fn(&Sink) -> bool,
        ) -> bool {
            if dest.binding == *function {
                return true;
            }
            sinks.get(&dest.binding).is_some_and(|ss| {
                ss.iter()
                    .any(|(s, _)| store(s) || matches!(s, Sink::Result(f) if f == function))
            })
        }
        let mut retained = HashMap::new();
        let empty = HashSet::new();
        for (param, function) in &parameters {
            let ss = sinks.get(param).unwrap_or(&empty);
            let store = |s: &Sink| match s {
                Sink::Result(_) => false,
                Sink::IntoParam => true,
                Sink::Store(o) => o != function && !encloses(*function, *o),
            };
            // Captured by a closure that outlives the call (returned or stored), directly or
            // through a local it was copied into: the closure keeps the container itself.
            // Locals of this function the parameter (or part of it) flows into: the same
            // container, one holding it (`{ p }`), or one of its members (`p.child`). `member`
            // records that only part of the parameter is held there.
            let mut aliases = vec![(*param, false)];
            let mut seen_alias: HashMap<Span, bool> = HashMap::from([(*param, false)]);
            while let Some((b, member)) = aliases.pop() {
                for (src, dest, _) in &self.copies {
                    let temporary = !self.bindings.contains_key(&dest.binding)
                        && !parameters.contains_key(&dest.binding)
                        && !self.functions.contains_key(&dest.binding);
                    if src.binding == b
                        && (self.bindings.get(&dest.binding) == Some(function) || temporary)
                        && !seen_alias.contains_key(&dest.binding)
                    {
                        let m = member || (!src.path.is_empty() && !temporary);
                        seen_alias.insert(dest.binding, m);
                        aliases.push((dest.binding, m));
                    }
                }
            }
            let escaping_capture = |b: &Span| {
                self.captured_by.get(b).is_some_and(|fs| {
                    fs.iter().any(|f| {
                        self.copies.iter().any(|(src, dest, _)| {
                            src.binding == *f
                                && src.path.is_empty()
                                && dest.binding != *f
                                && sinks_of_value(&sinks, dest, function, &store)
                        })
                    })
                })
            };
            let captured_part = seen_alias.iter().any(|(b, m)| *m && escaping_capture(b));
            let seen_alias: HashSet<Span> = seen_alias.into_iter().filter(|(_, m)| !m).map(|(b, _)| b).collect();
            let captured_kept = seen_alias.iter().any(|b| {
                self.captured_by.get(b).is_some_and(|fs| {
                    fs.iter().any(|f| {
                        self.copies.iter().any(|(src, dest, _)| {
                            src.binding == *f
                                && src.path.is_empty()
                                && dest.binding != *f
                                && sinks_of_value(&sinks, dest, function, &store)
                        })
                    })
                })
            });
            let whole = captured_kept || ss.iter().any(|(s, m)| !m && store(s));
            let part = captured_part || ss.iter().any(|(s, m)| *m && store(s));
            let returned = ss
                .iter()
                .any(|(s, m)| !m && matches!(s, Sink::Result(f) if f == function));
            let returned_part = ss
                .iter()
                .any(|(s, m)| *m && matches!(s, Sink::Result(f) if f == function));
            if whole || part || returned || returned_part {
                retained.insert(
                    *param,
                    Kept {
                        whole,
                        part,
                        returned,
                        returned_part,
                    },
                );
            }
        }
        let sinks: HashMap<Span, HashSet<Sink>> = sinks
            .into_iter()
            .map(|(b, ss)| (b, ss.into_iter().map(|(s, _)| s).collect()))
            .collect();
        let mut shared = HashSet::new();
        loop {
            let before = shared.len();
            for (src, ss) in &sinks {
                for s in ss {
                    let Sink::Result(f) = s else { continue };
                    if shared.contains(f) {
                        continue;
                    }
                    let held = if self.functions.contains_key(src) {
                        shared.contains(src)
                    } else if self.externals.contains(src) {
                        // A module container: the config holds it too.
                        true
                    } else if let Some(p) = parameters.get(src) {
                        // Its own parameter returned: the caller joins the argument itself. A
                        // parameter of an enclosing function: captured, held there too.
                        p != f
                    } else if let Some(o) = self.bindings.get(src) {
                        o != f
                    } else {
                        false
                    };
                    if held {
                        shared.insert(*f);
                    }
                }
            }
            if shared.len() == before {
                return (retained, shared);
            }
        }
    }

    fn solve(mut self) -> Effects {
        self.max_depth = self
            .copies
            .iter()
            .flat_map(|(a, b, _)| [a.path.len(), b.path.len()])
            .chain(self.numeric.iter().map(|p| p.path.len()))
            .max()
            .unwrap_or(0)
            + 1;
        loop {
            let before = (
                self.reachable.len(),
                self.incoming.len(),
                self.incoming_writes.len(),
                self.values.len(),
                self.copies.len(),
                self.numeric.len(),
                self.writes.len(),
                self.function_numeric.values().map(HashSet::len).sum::<usize>(),
                self.function_writes.values().map(HashSet::len).sum::<usize>(),
                self.events.values().map(HashSet::len).sum::<usize>(),
                self.write_events.values().map(HashSet::len).sum::<usize>(),
            );
            for call in &self.calls {
                if !self.reachable.contains(&call.owner) {
                    continue;
                }
                for (_, function) in self.values.iter().filter(|(value, _)| callable_at(value, &call.callee)) {
                    self.reachable.insert(*function);
                    let params = &self.functions[function];
                    for (arg, param) in call.args.iter().zip(params) {
                        if let Some(arg) = arg {
                            self.copies.insert((arg.clone(), param.clone(), call.owner));
                        }
                    }
                    self.copies
                        .insert((Place::new(*function).at(Step::Result), call.result.clone(), call.owner));
                }
            }
            let values: Vec<_> = self.values.iter().cloned().collect();
            for (src, dest, owner) in &self.copies {
                if !self.reachable.contains(owner) {
                    continue;
                }
                for (value, function) in &values {
                    if value.binding == src.binding
                        && let Some(suffix) = projected_suffix(&value.path, &src.path)
                    {
                        let mut target = dest.clone();
                        target.path.extend_from_slice(suffix);
                        self.values.insert((self.bounded(target), *function));
                    }
                }
            }
            for incoming in [&mut self.incoming, &mut self.incoming_writes] {
                let mut projected = Vec::new();
                for (binding, view) in &self.parameter_views {
                    for p in incoming.iter() {
                        if p.binding == view.binding
                            && let Some(path) = projected_suffix(&p.path, &view.path)
                        {
                            projected.push(Place {
                                binding: *binding,
                                path: path.to_vec(),
                            });
                        }
                    }
                }
                incoming.extend(projected);
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
                for (_, function) in self.values.iter().filter(|(value, _)| callable_at(value, &call.callee)) {
                    for (arg, param) in call.args.iter().zip(&self.functions[function]) {
                        let Some(arg) = arg else {
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
                            if p.binding == arg.binding
                                && let Some(path) = projected_suffix(&p.path, &arg.path)
                            {
                                let mut target = param.clone();
                                target.path.extend_from_slice(path);
                                incoming.push(self.bounded(target));
                            }
                        }
                        self.incoming.extend(incoming);
                        let prior = call
                            .prior
                            .iter()
                            .filter_map(|event| self.write_events.get(event))
                            .flatten();
                        let inputs = self
                            .incoming_writes
                            .iter()
                            .chain(prior)
                            .chain(self.writes.iter().filter(|_| captures));
                        let mut incoming = Vec::new();
                        for p in inputs {
                            if p.binding == arg.binding
                                && let Some(path) = projected_suffix(&p.path, &arg.path)
                            {
                                let mut target = param.clone();
                                target.path.extend_from_slice(path);
                                incoming.push(self.bounded(target));
                            }
                        }
                        self.incoming_writes.extend(incoming);
                    }
                    let summary = self.function_numeric.get(function).cloned().unwrap_or_default();
                    for p in summary {
                        let param = self.functions[function]
                            .iter()
                            .position(|param| param.binding == p.binding);
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
                    let summary = self.function_writes.get(function).cloned().unwrap_or_default();
                    for p in summary {
                        let param = self.functions[function]
                            .iter()
                            .position(|param| param.binding == p.binding);
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
                        self.write_events.entry(call.span).or_default().insert(target.clone());
                        self.function_writes.entry(call.owner).or_default().insert(target);
                    }
                }
            }
            if before
                == (
                    self.reachable.len(),
                    self.incoming.len(),
                    self.incoming_writes.len(),
                    self.values.len(),
                    self.copies.len(),
                    self.numeric.len(),
                    self.writes.len(),
                    self.function_numeric.values().map(HashSet::len).sum::<usize>(),
                    self.function_writes.values().map(HashSet::len).sum::<usize>(),
                    self.events.values().map(HashSet::len).sum::<usize>(),
                    self.write_events.values().map(HashSet::len).sum::<usize>(),
                )
            {
                break;
            }
        }
        let mut entry_history: HashMap<Span, HashSet<Span>> = HashMap::new();
        loop {
            let before = entry_history.values().map(HashSet::len).sum::<usize>();
            for call in &self.calls {
                if !self.reachable.contains(&call.owner) {
                    continue;
                }
                let mut prior = entry_history.get(&call.owner).cloned().unwrap_or_default();
                prior.extend(&call.prior);
                for (_, function) in self.values.iter().filter(|(value, _)| callable_at(value, &call.callee)) {
                    entry_history.entry(*function).or_default().extend(&prior);
                }
            }
            if before == entry_history.values().map(HashSet::len).sum::<usize>() {
                break;
            }
        }
        // Possible entry events invalidate reads. Only events preceding every
        // entry may be discounted at creation: two calls can create different
        // instances of the same lexical closure. Loop events may repeat after
        // creation, so they are never creation predecessors.
        let repeating: HashSet<_> = self.loop_events.values().flatten().copied().collect();
        let mut creation_entries = entry_history.clone();
        for events in creation_entries.values_mut() {
            events.retain(|event| !repeating.contains(event));
        }
        for root in &self.roots {
            creation_entries.insert(*root, HashSet::new());
        }
        loop {
            let mut next: HashMap<Span, HashSet<Span>> =
                self.roots.iter().map(|root| (*root, HashSet::new())).collect();
            for call in &self.calls {
                if !self.reachable.contains(&call.owner) {
                    continue;
                }
                let mut prior = creation_entries.get(&call.owner).cloned().unwrap_or_default();
                prior.extend(call.prior.difference(&repeating));
                for (_, function) in self.values.iter().filter(|(value, _)| callable_at(value, &call.callee)) {
                    next.entry(*function)
                        .and_modify(|events| events.retain(|event| prior.contains(event)))
                        .or_insert_with(|| prior.clone());
                }
            }
            if next == creation_entries {
                break;
            }
            creation_entries = next;
        }
        let mut capture_writes = self.function_writes.clone();
        for (function, prior) in &entry_history {
            let mut created = self.created_prior.get(function).cloned().unwrap_or_default();
            created.retain(|event| !repeating.contains(event));
            if let Some(owner) = self.created_by.get(function) {
                created.extend(creation_entries.get(owner).into_iter().flatten());
            }
            for event in prior.difference(&created) {
                capture_writes
                    .entry(*function)
                    .or_default()
                    .extend(self.write_events.get(event).into_iter().flatten().cloned());
            }
        }
        let summaries = |histories: &HashMap<Span, HashSet<Span>>| {
            histories
                .iter()
                .map(|(span, events)| {
                    (
                        *span,
                        events
                            .iter()
                            .flat_map(|event| self.write_events.get(event).into_iter().flatten().cloned())
                            .collect(),
                    )
                })
                .collect()
        };
        let expression_writes = summaries(&self.expression_events);
        let loop_writes = summaries(&self.loop_events);
        let (retained, shared) = self.retention();
        let mut write_depths: HashMap<(Span, usize, bool), usize> = HashMap::new();
        let mut shared_calls = HashSet::new();
        let mut stores_into = HashSet::new();
        let mut stored_arguments = HashSet::new();
        let mut stored_members = HashSet::new();
        let mut returned_members = HashSet::new();
        let stored: HashSet<Span> = self
            .copies
            .iter()
            .filter(|(src, dest, _)| src.binding != dest.binding && !dest.path.is_empty())
            .map(|(_, dest, _)| dest.binding)
            .collect();
        let mut resolved_calls = HashSet::new();
        let mut retained_arguments: HashMap<Span, HashSet<usize>> = HashMap::new();
        // Each function → member writes into bindings it doesn't own, including through the
        // functions it calls (to a fixpoint), with the deepest write per binding.
        let mut foreign: HashMap<Span, HashMap<Span, usize>> = HashMap::new();
        for (function, writes) in &self.function_writes {
            for p in writes {
                if !p.path.is_empty() && self.bindings.get(&p.binding).is_some_and(|o| o != function) {
                    let depth = if p.path.contains(&Step::Descendants) {
                        usize::MAX / 2
                    } else {
                        p.path.len()
                    };
                    let slot = foreign.entry(*function).or_default().entry(p.binding).or_default();
                    *slot = (*slot).max(depth);
                }
            }
        }
        loop {
            let mut changed = false;
            for call in &self.calls {
                let callees: Vec<Span> = self
                    .values
                    .iter()
                    .filter(|(value, _)| callable_at(value, &call.callee))
                    .map(|(_, f)| *f)
                    .collect();
                for f in callees {
                    let inherited: Vec<(Span, usize)> = foreign
                        .get(&f)
                        .into_iter()
                        .flatten()
                        .filter(|(b, _)| self.bindings.get(b).is_some_and(|o| *o != call.owner))
                        .map(|(b, d)| (*b, *d))
                        .collect();
                    for (b, d) in inherited {
                        let slot = foreign.entry(call.owner).or_default().entry(b).or_default();
                        if *slot < d {
                            *slot = d;
                            changed = true;
                        }
                    }
                }
            }
            if !changed {
                break;
            }
        }
        let mut captured_writes: HashMap<Span, HashMap<Span, usize>> = HashMap::new();
        for call in &self.calls {
            if call.callback {
                continue;
            }
            for (_, function) in self.values.iter().filter(|(value, _)| callable_at(value, &call.callee)) {
                for (b, d) in foreign.get(function).into_iter().flatten() {
                    let slot = captured_writes.entry(call.span).or_default().entry(*b).or_default();
                    *slot = (*slot).max(*d);
                }
            }
        }
        let mut reference_arguments: HashMap<Span, HashSet<usize>> = HashMap::new();
        for call in &self.calls {
            for (_, function) in self.values.iter().filter(|(value, _)| callable_at(value, &call.callee)) {
                if !call.callback {
                    resolved_calls.insert(call.span);
                }
                if shared.contains(function) && !call.callback {
                    shared_calls.insert(call.span);
                }
                for (index, param) in self.functions[function].iter().enumerate() {
                    if stored.contains(&param.binding) && !call.callback {
                        stores_into.insert((call.span, index));
                    }
                    if let Some(Kept {
                        whole,
                        part,
                        returned,
                        returned_part,
                    }) = retained.get(&param.binding)
                        && !call.callback
                    {
                        if *returned {
                            retained_arguments.entry(call.span).or_default().insert(index);
                        }
                        if *returned_part {
                            returned_members.insert((call.span, index));
                        }
                        if *whole {
                            stored_arguments.insert((call.span, index));
                        }
                        if *part {
                            stored_members.insert((call.span, index));
                        }
                    }
                    let depth = self
                        .writes
                        .iter()
                        .filter(|p| p.binding == param.binding && !p.path.is_empty())
                        .map(|p| {
                            if p.path.contains(&Step::Descendants) {
                                usize::MAX / 2
                            } else {
                                p.path.len()
                            }
                        })
                        .max();
                    if let Some(depth) = depth {
                        let slot = write_depths.entry((call.span, index, call.callback)).or_default();
                        *slot = (*slot).max(depth);
                    }
                    if self
                        .writes
                        .iter()
                        .any(|p| p.binding == param.binding && !p.path.is_empty())
                    {
                        reference_arguments.entry(call.span).or_default().insert(index);
                    }
                }
            }
        }
        let mut effects = Effects {
            captured: self.captured,
            numeric: HashMap::new(),
            incoming: HashMap::new(),
            incoming_writes: HashMap::new(),
            writes: self.writes,
            parameters: self.functions.values().flatten().map(|p| p.binding).collect(),
            capture_writes,
            events: self.events,
            write_events: self.write_events,
            expression_writes,
            expression_places: self.expression_places,
            loop_writes,
            reference_arguments,
            resolved_calls,
            retained_arguments,
            write_depths,
            shared_calls,
            stores_into,
            stored_arguments,
            stored_members,
            returned_members,
            captured_writes,
        };
        for p in self.numeric {
            effects.numeric.entry(p.binding).or_default().insert(p.path);
        }
        for p in self.incoming {
            effects.incoming.entry(p.binding).or_default().insert(p.path);
        }
        for p in self.incoming_writes {
            effects.incoming_writes.entry(p.binding).or_default().insert(p.path);
        }
        effects
    }
}
