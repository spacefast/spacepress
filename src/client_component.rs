//! Generator B: a `"use client"` component compiled to the WordPress Interactivity API
//! (docs/decisions/2026-11-08-tsx-to-php.md, "Code generator B"; docs/spec/rendering.md §4.1).
//!
//! A client component is analysed once, from its IR:
//! - its `useState` calls become fields of the root element's `data-wp-context`, seeded from their
//!   initial values (the component's props, or literals);
//! - other `const`s in its body are derived values: `state` getters in the store;
//! - functions it passes to `on*` attributes, and its `useEffect`/`useMount`/`useEvent` callbacks,
//!   become actions and callbacks;
//! - `sharedState({...})` exported from the module is the namespace's global `state`.
//!
//! The server HTML comes from generator A (compile.rs), which asks [`Analysis`] how each reference
//! in the markup maps to a directive. This module writes the store module, plain JavaScript that
//! imports only `@wordpress/interactivity`. No bundler runs: client files may import only other
//! relative modules of the same kind (none yet), so there is nothing to bundle.

use crate::diag::{Diag, Result, Span};
use crate::ir::*;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::rc::Rc;

/// Standard React hooks supported in `"use client"` components (imported from `"react"`).
pub const REACT_HOOKS: &[&str] = &["useState", "useEffect", "useRef"];

/// SpacePress-specific client hooks (imported from `"spacepress/react"` or `"@spacepress/client/react"`).
pub const CLIENT_HOOKS: &[&str] = &[
    "useMount",
    "useEvent",
    "sharedState",
    "useLive",
    "useMutation",
    "uploadFile",
];

/// All hooks supported by the Interactivity API client component compiler.
pub const HOOKS: &[&str] = &[
    "useState",
    "useEffect",
    "useMount",
    "useEvent",
    "useRef",
    "sharedState",
    "useLive",
    "useMutation",
    "uploadFile",
];

/// What a reference in a client component's markup or code reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Binding {
    /// A `useState` value: `context.<name>`; its setter is `set`.
    State { setter: Option<String> },
    /// A `useState` setter.
    Setter { field: String },
    /// A prop: also a context field, seeded from the prop.
    Prop,
    /// A derived `const`: `state.<name>`.
    Derived,
    /// A handler function: `actions.<name>`.
    Action,
    /// A `useRef()`: the element whose `ref={name}` names it.
    Ref,
    /// A server action the file imports (its registered name): called through `fetch`.
    ServerAction(String),
    /// Generated `api` object imported from `<dir>/_generated/api`.
    GeneratedApi,
    /// A `useMutation(api.actions.<name>)` handle: reactive `{ pending, error }` + `.mutate(...)` / `.reset()`.
    Mutation(String),
    /// `uploadFile` imported from `"spacepress/react"`: uploads to a `files()` bucket via `spacepress/client`.
    UploadFile,
    /// `sharedState` exported from this module: the namespace's global `state`.
    Shared,
    /// An imported CSS module's class map, known at build time: inlined as a JavaScript object.
    Static(String),
    /// The item of a list a `data-wp-each--<name>` template renders: `context.<name>`, set per
    /// item by the Interactivity runtime.
    Item,
}

#[derive(Debug, Default)]
pub struct Analysis {
    /// `<app>/<Component>`.
    pub namespace: String,
    pub bindings: BTreeMap<String, Binding>,
    /// useState fields in source order: (field, initial expression).
    pub state: Vec<(String, Expr)>,
    /// Derived consts in source order.
    pub derived: Vec<(String, Expr)>,
    /// Named handler functions (`const inc = () => …` / `function inc() {…}`).
    pub actions: Vec<(String, Rc<Func>)>,
    /// Inline handlers in JSX get a generated name: span → name.
    pub inline: BTreeMap<(u32, u32), String>,
    /// `useEffect(fn, deps)` (watch) and `useMount(fn)` (init) callbacks.
    pub watch: Vec<(String, Rc<Func>)>,
    pub init: Vec<(String, Rc<Func>)>,
    /// `useEvent("resize", fn)` / `useEvent("keydown", fn, "document")`: (target, event, callback name).
    pub events: Vec<(String, String, String)>,
    /// Server actions called from handlers or `useMutation(...)`.
    pub server_actions: BTreeSet<String>,
    /// Private file buckets uploaded to via `uploadFile(bucket, file, opts?)`.
    pub file_uploads: BTreeSet<String>,
    /// Static assets imported by this client component (resolved through `getConfig(ns).assets`).
    pub assets: BTreeMap<String, crate::schema::IslandAsset>,
    /// Module-level `export const x = sharedState({...})`: (name, initial object).
    pub shared: Vec<(String, Expr)>,
    /// The props the component destructures, in order.
    pub props: Vec<String>,
    /// `const todos = useLive(api.todos.list({ where, limit }))`: (field, kind, args, enabled).
    /// The field is a context value `{ data, error, loading }` the server seeds and the browser keeps current.
    pub live: Vec<(String, String, Expr, Expr)>,
    /// `const add = useMutation(api.actions.addNote)`: (field, action name).
    /// The field is a reactive context object `{ pending, error }`.
    pub mutations: Vec<(String, String)>,
    /// Each `useRef()` an element's `ref={name}` attached, with that attribute's place in the
    /// source (generator A records them; a conditional's element compiles twice).
    pub refs: BTreeMap<String, (u32, u32)>,
    /// Names the module declares or imports at its top level. One that shares a browser global's
    /// name (`const fetch = …`) is the module's, which the browser doesn't have, so it is refused
    /// rather than read as the global.
    pub module_names: BTreeSet<String>,
}

pub(crate) fn refuse(span: Span, message: impl Into<String>, help: impl Into<String>) -> Diag {
    Diag::new(span, message).help(help)
}

/// The hook a callee names, if it is one imported from `"spacepress/client"`.
fn hook<'a>(callee: &Expr, hooks: &'a BTreeMap<String, &'static str>) -> Option<&'a str> {
    match &callee.kind {
        ExprKind::Ident(n) => hooks.get(n).copied(),
        _ => None,
    }
}

pub struct ClientImports {
    pub hooks: BTreeMap<String, &'static str>,
    pub api_locals: BTreeSet<String>,
    pub others: Vec<(String, String)>,
}

/// Local names bound to `"react"` and `"spacepress/react"` hooks in `module`, generated `api`
/// bindings from `<dir>/_generated/api`, and server actions it imports.
pub fn imports(module: &Module, program: &crate::loader::Program) -> ClientImports {
    let mut hooks = BTreeMap::new();
    let mut api_locals = BTreeSet::new();
    let mut others = Vec::new();
    for stmt in &module.body {
        if let Stmt::Import { source, specs, .. } = stmt {
            let is_api = crate::loader::is_generated_api_import(&program.root, &program.layout, &module.path, source);
            for spec in specs {
                if spec.type_only {
                    continue;
                }
                if source == crate::loader::REACT_MODULE {
                    if let ImportName::Named(n) = &spec.imported
                        && let Some(h) = REACT_HOOKS.iter().find(|h| **h == n.as_str())
                    {
                        hooks.insert(spec.local.clone(), *h);
                    }
                } else if crate::loader::is_client_react_module(source) {
                    if let ImportName::Named(n) = &spec.imported
                        && let Some(h) = CLIENT_HOOKS.iter().find(|h| **h == n.as_str())
                    {
                        hooks.insert(spec.local.clone(), *h);
                    }
                } else if is_api {
                    if let ImportName::Named(n) = &spec.imported
                        && n == "api"
                    {
                        api_locals.insert(spec.local.clone());
                    }
                } else if let ImportName::Named(n) = &spec.imported {
                    others.push((spec.local.clone(), n.clone()));
                }
            }
        }
    }
    ClientImports {
        hooks,
        api_locals,
        others,
    }
}

/// Analyses one client component: `f` is its function, `module` its module, `actions` the
/// registered server action names its imports may bind, and `file_buckets` the registered
/// `files()` bucket names `uploadFile(...)` may target.
pub fn analyse(
    namespace: String,
    f: &Func,
    module: &Module,
    program: &crate::loader::Program,
    server_actions: &BTreeSet<String>,
    file_buckets: &BTreeSet<String>,
    assets: &[(String, &crate::assets::Asset)],
) -> Result<Analysis> {
    let ClientImports {
        hooks,
        api_locals,
        others: imported,
    } = imports(module, program);
    let mut a = Analysis {
        namespace,
        ..Default::default()
    };
    for api_local in api_locals {
        a.bindings.insert(api_local, Binding::GeneratedApi);
    }
    // Default imports of stylesheets and static assets, by local name.
    for (local, asset) in assets {
        match asset.kind {
            crate::assets::Kind::CssModule => {
                let fields: Vec<String> = asset
                    .classes
                    .iter()
                    .map(|(k, v)| format!("{}: {}", js_str(k), js_str(v)))
                    .collect();
                a.bindings
                    .insert(local.clone(), Binding::Static(format!("{{ {} }}", fields.join(", "))));
            }
            crate::assets::Kind::Raw | crate::assets::Kind::Inline => {
                if let Some(text) = &asset.text {
                    a.bindings.insert(local.clone(), Binding::Static(js_str(text)));
                }
            }
            crate::assets::Kind::File => {
                a.assets
                    .insert(local.clone(), crate::schema::IslandAsset::Url(asset.file.clone()));
                a.bindings.insert(
                    local.clone(),
                    Binding::Static(format!("getConfig(ns).assets[{}]", js_str(local))),
                );
            }
            crate::assets::Kind::Meta => {
                if let Some(meta) = &asset.meta {
                    a.assets.insert(
                        local.clone(),
                        crate::schema::IslandAsset::Meta {
                            file: asset.file.clone(),
                            width: meta.width,
                            height: meta.height,
                            format: meta.format.clone(),
                        },
                    );
                    a.bindings.insert(
                        local.clone(),
                        Binding::Static(format!("getConfig(ns).assets[{}]", js_str(local))),
                    );
                }
            }
            crate::assets::Kind::Css => {}
        }
    }
    for (local, name) in &hooks {
        if *name == "uploadFile" {
            a.bindings.insert(local.clone(), Binding::UploadFile);
        }
    }
    for (local, name) in imported {
        if server_actions.contains(&name) {
            a.bindings.insert(local, Binding::ServerAction(name));
        }
    }
    for stmt in &module.body {
        let stmt = match stmt {
            Stmt::Exported(inner) => &**inner,
            s => s,
        };
        match stmt {
            Stmt::Decl { pat, .. } => {
                let mut names = Vec::new();
                pat.bindings(&mut names);
                a.module_names.extend(names.into_iter().map(|(n, _)| n.to_string()));
            }
            Stmt::Func(func) => a.module_names.extend(func.name.clone()),
            Stmt::Import { specs, .. } => a.module_names.extend(specs.iter().map(|s| s.local.clone())),
            _ => {}
        }
    }
    // Module-level shared state.
    for stmt in &module.body {
        let Stmt::Exported(inner) = stmt else { continue };
        if let Stmt::Decl {
            pat: Pat::Id(name, _),
            init: Some(init),
            ..
        } = &**inner
            && let ExprKind::Call { callee, args, .. } = &init.kind
            && hook(callee, &hooks) == Some("sharedState")
        {
            let [ArrEl::Item(obj)] = args.as_slice() else {
                return Err(refuse(
                    init.span,
                    "`sharedState` takes one object",
                    "write `sharedState({ items: [] })`",
                ));
            };
            a.shared.push((name.clone(), obj.clone()));
            a.bindings.insert(name.clone(), Binding::Shared);
        }
    }
    // Props: one destructured object parameter. A component whose code reads `this` has the
    // lowerer's hidden receiver first; the read itself is refused where it is compiled.
    let params = if f.receives_this { &f.params[1..] } else { &f.params[..] };
    match params {
        [] => {}
        [p] => match &p.pat {
            Pat::Obj { props, rest: None, .. } => {
                for (key, pat) in props {
                    let local = match pat {
                        Pat::Id(n, _) => n.clone(),
                        Pat::Default(inner, _) => match &**inner {
                            Pat::Id(n, _) => n.clone(),
                            _ => {
                                return Err(refuse(
                                    p.span,
                                    "nested props patterns aren't supported in client components",
                                    "destructure the top-level props only",
                                ));
                            }
                        },
                        _ => {
                            return Err(refuse(
                                p.span,
                                "nested props patterns aren't supported in client components",
                                "destructure the top-level props only",
                            ));
                        }
                    };
                    // The context field is the local name the component's code reads.
                    let _ = key;
                    a.props.push(local.clone());
                    a.bindings.insert(local, Binding::Prop);
                }
            }
            _ => {
                return Err(refuse(
                    p.span,
                    "a client component destructures its props",
                    "write `function Counter({ start }: { start: number })`",
                ));
            }
        },
        [_, second, ..] => {
            return Err(refuse(
                second.span,
                "a component takes one props object",
                "destructure every prop from the first parameter",
            ));
        }
    }
    let FnBody::Block(body) = &f.body else {
        return Err(refuse(
            f.span,
            "a client component needs a body with `return`",
            "write `{ const [n, setN] = useState(0); return <button>…</button>; }`",
        ));
    };
    let mut returned = false;
    let mut n = 0;
    for stmt in body {
        match stmt {
            Stmt::Decl {
                pat,
                init: Some(init),
                kind,
                span,
                ..
            } => {
                if let ExprKind::Call { callee, args, .. } = &init.kind
                    && let Some(h) = hook(callee, &hooks)
                {
                    match h {
                        "useState" => {
                            let Pat::Arr { elems, rest: None, .. } = pat else {
                                return Err(refuse(
                                    *span,
                                    "`useState` returns a pair",
                                    "write `const [count, setCount] = useState(0)`",
                                ));
                            };
                            let name = match elems.first() {
                                Some(Some(Pat::Id(n, _))) => n.clone(),
                                _ => {
                                    return Err(refuse(
                                        *span,
                                        "`useState` needs a value name",
                                        "write `const [count, setCount] = useState(0)`",
                                    ));
                                }
                            };
                            let setter = match elems.get(1) {
                                Some(Some(Pat::Id(s, _))) => Some(s.clone()),
                                None | Some(None) => None,
                                _ => {
                                    return Err(refuse(
                                        *span,
                                        "the setter is a plain name",
                                        "write `const [count, setCount] = useState(0)`",
                                    ));
                                }
                            };
                            let initial = match args.as_slice() {
                                [ArrEl::Item(e)] => e.clone(),
                                [] => Expr {
                                    kind: ExprKind::Undefined,
                                    span: init.span,
                                },
                                _ => {
                                    return Err(refuse(
                                        init.span,
                                        "`useState` takes one initial value",
                                        "pass the value, not a function",
                                    ));
                                }
                            };
                            if matches!(initial.kind, ExprKind::Func(_)) {
                                return Err(refuse(
                                    initial.span,
                                    "lazy `useState(() => …)` isn't supported",
                                    "pass the initial value itself",
                                ));
                            }
                            a.state.push((name.clone(), initial));
                            a.bindings
                                .insert(name.clone(), Binding::State { setter: setter.clone() });
                            if let Some(s) = setter {
                                a.bindings.insert(s, Binding::Setter { field: name });
                            }
                        }
                        "useLive" => {
                            let Pat::Id(name, _) = pat else {
                                return Err(refuse(
                                    *span,
                                    "`useLive` is assigned to a name",
                                    "write `const todos = useLive(api.todos.list({ where: { done: false } }))`",
                                ));
                            };
                            let help = "import `{ api }` from \"../_generated/api\" and write `useLive(api.todos.list({ where: { done: false }, limit: 20 }))`";
                            let (first_arg, opt_arg) = match args.as_slice() {
                                [ArrEl::Item(first)] => (first, None),
                                [ArrEl::Item(first), opt] => (first, Some(opt)),
                                _ => {
                                    return Err(refuse(
                                        init.span,
                                        "`useLive` takes a typed query from `_generated/api` and optional `{ enabled }`",
                                        help,
                                    ));
                                }
                            };
                            if let ExprKind::Str(k) = &first_arg.kind {
                                return Err(refuse(
                                    first_arg.span,
                                    "`useLive` takes a typed query from `_generated/api`, not a string",
                                    format!(
                                        "import `{{ api }}` from \"../_generated/api\" and write `useLive(api.{k}.list({{ limit: 20 }}))`"
                                    ),
                                ));
                            }
                            let (kind, query) = match &first_arg.kind {
                                ExprKind::Call {
                                    callee,
                                    args: list_args,
                                    optional: false,
                                    ..
                                } => match &callee.kind {
                                    ExprKind::Member {
                                        obj,
                                        prop,
                                        optional: false,
                                        ..
                                    } if prop == "list" => match &obj.kind {
                                        ExprKind::Member {
                                            obj: root,
                                            prop: kind,
                                            optional: false,
                                            ..
                                        } => match &root.kind {
                                            ExprKind::Ident(api_name)
                                                if a.bindings.get(api_name) == Some(&Binding::GeneratedApi) =>
                                            {
                                                let query = match list_args.as_slice() {
                                                    [] => Expr {
                                                        kind: ExprKind::Object(Vec::new()),
                                                        span: first_arg.span,
                                                    },
                                                    [ArrEl::Item(q)] => q.clone(),
                                                    [ArrEl::Spread(x), ..] => {
                                                        return Err(refuse(
                                                            x.span,
                                                            "`useLive` takes its query as an object",
                                                            help,
                                                        ));
                                                    }
                                                    _ => {
                                                        return Err(refuse(
                                                            first_arg.span,
                                                            format!(
                                                                "`api.{kind}.list()` takes an optional query object"
                                                            ),
                                                            help,
                                                        ));
                                                    }
                                                };
                                                (kind.clone(), query)
                                            }
                                            _ => {
                                                return Err(refuse(
                                                    first_arg.span,
                                                    "`useLive` takes a typed query from `_generated/api`",
                                                    help,
                                                ));
                                            }
                                        },
                                        _ => {
                                            return Err(refuse(
                                                first_arg.span,
                                                "`useLive` takes a typed query from `_generated/api`",
                                                help,
                                            ));
                                        }
                                    },
                                    _ => {
                                        return Err(refuse(
                                            first_arg.span,
                                            "`useLive` takes an `api.<kind>.list(...)` query",
                                            help,
                                        ));
                                    }
                                },
                                _ => {
                                    return Err(refuse(
                                        first_arg.span,
                                        "`useLive` takes a typed query from `_generated/api`",
                                        help,
                                    ));
                                }
                            };
                            // The browser subscribes to the read the server answered: its arguments
                            // come from props and literals, which both sides have.
                            let mut fixed = true;
                            visit(&query, &mut |x| {
                                if let ExprKind::Ident(n) = &x.kind
                                    && !matches!(
                                        a.bindings.get(n),
                                        Some(Binding::Prop) | Some(Binding::Static(_)) | None
                                    )
                                {
                                    fixed = false;
                                }
                                if matches!(x.kind, ExprKind::Func(_) | ExprKind::Await(_)) {
                                    fixed = false;
                                }
                            });
                            if !fixed {
                                return Err(refuse(
                                    query.span,
                                    "a `useLive` query reads props and literals only",
                                    "pass what the query depends on as a prop; a query that follows state changes isn't supported yet",
                                ));
                            }
                            let enabled = match opt_arg {
                                None => Expr {
                                    kind: ExprKind::Bool(true),
                                    span: init.span,
                                },
                                Some(ArrEl::Item(Expr {
                                    kind: ExprKind::Object(props),
                                    span: ospan,
                                })) => {
                                    let mut enabled = Expr {
                                        kind: ExprKind::Bool(true),
                                        span: *ospan,
                                    };
                                    for p in props {
                                        match p {
                                            Prop::KV(PropKey::Static(k), v) if k == "enabled" => enabled = v.clone(),
                                            _ => {
                                                return Err(refuse(
                                                    *ospan,
                                                    "`useLive` options are `{ enabled }`",
                                                    "the server's answer seeds the read, so there is no `seed` option",
                                                ));
                                            }
                                        }
                                    }
                                    enabled
                                }
                                Some(ArrEl::Item(o)) | Some(ArrEl::Spread(o)) => {
                                    return Err(refuse(
                                        o.span,
                                        "`useLive` options are an object",
                                        "write `{ enabled: false }`",
                                    ));
                                }
                            };
                            a.live.push((name.clone(), kind, query, enabled));
                            a.bindings.insert(name.clone(), Binding::State { setter: None });
                        }
                        "useMutation" => {
                            let Pat::Id(name, _) = pat else {
                                return Err(refuse(
                                    *span,
                                    "`useMutation` is assigned to a name",
                                    "write `const save = useMutation(api.saveNote)`",
                                ));
                            };
                            let help = "import `{ api }` from \"#sp/api\" and write `const save = useMutation(api.saveNote)`";
                            let [ArrEl::Item(arg)] = args.as_slice() else {
                                return Err(refuse(
                                    init.span,
                                    "`useMutation` takes an action reference from `#sp/api`",
                                    help,
                                ));
                            };
                            let action_name = match &arg.kind {
                                ExprKind::Member {
                                    obj,
                                    prop: action_name,
                                    optional: false,
                                    ..
                                } => match &obj.kind {
                                    ExprKind::Ident(api_name)
                                        if a.bindings.get(api_name) == Some(&Binding::GeneratedApi) =>
                                    {
                                        action_name.clone()
                                    }
                                    ExprKind::Member {
                                        obj: root,
                                        prop: actions_prop,
                                        optional: false,
                                        ..
                                    } if actions_prop == "actions"
                                        && matches!(&root.kind, ExprKind::Ident(api_name) if a.bindings.get(api_name) == Some(&Binding::GeneratedApi)) =>
                                    {
                                        return Err(refuse(
                                            arg.span,
                                            format!("`api.actions.{action_name}` is now `api.{action_name}`"),
                                            format!("write `useMutation(api.{action_name})`"),
                                        ));
                                    }
                                    _ => {
                                        return Err(refuse(
                                            arg.span,
                                            "`useMutation` takes `api.<name>` from `#sp/api`",
                                            help,
                                        ));
                                    }
                                },
                                _ => {
                                    return Err(refuse(
                                        arg.span,
                                        "`useMutation` takes `api.<name>` from `#sp/api`",
                                        help,
                                    ));
                                }
                            };
                            if !server_actions.contains(&action_name) {
                                let mut d = Diag::new(arg.span, format!("unknown action `{action_name}`"));
                                if let Some(s) =
                                    crate::diag::suggest(&action_name, server_actions.iter().map(String::as_str))
                                {
                                    d = d.help(format!("did you mean `{s}`?"));
                                } else {
                                    d = d.help("export a `mutation()` or `query()` action first");
                                }
                                return Err(d);
                            }
                            a.mutations.push((name.clone(), action_name.clone()));
                            a.bindings.insert(name.clone(), Binding::Mutation(action_name));
                        }
                        "useRef" => {
                            let Pat::Id(name, _) = pat else {
                                return Err(refuse(
                                    *span,
                                    "`useRef()` is assigned to a name",
                                    "write `const input = useRef()`",
                                ));
                            };
                            a.bindings.insert(name.clone(), Binding::Ref);
                        }
                        other => {
                            return Err(refuse(
                                init.span,
                                format!("`{other}` doesn't return a value"),
                                format!("call `{other}(…)` as a statement"),
                            ));
                        }
                    }
                    continue;
                }
                if *kind != DeclKind::Const {
                    return Err(refuse(
                        *span,
                        "a client component's locals are `const`",
                        "keep changing values in `useState`",
                    ));
                }
                let Pat::Id(name, _) = pat else {
                    return Err(refuse(
                        *span,
                        "destructuring a derived value isn't supported",
                        "derive each value as its own `const`",
                    ));
                };
                if let ExprKind::Func(func) = &init.kind {
                    a.actions.push((name.clone(), func.clone()));
                    a.bindings.insert(name.clone(), Binding::Action);
                } else {
                    a.derived.push((name.clone(), init.clone()));
                    a.bindings.insert(name.clone(), Binding::Derived);
                }
            }
            Stmt::Func(func) => {
                let name = func.name.clone().unwrap_or_default();
                a.actions.push((name.clone(), func.clone()));
                a.bindings.insert(name, Binding::Action);
            }
            Stmt::Expr(e) => {
                let ExprKind::Call { callee, args, .. } = &e.kind else {
                    return Err(refuse(
                        e.span,
                        "a client component's body declares values, hooks and handlers",
                        "move this into a handler or an effect",
                    ));
                };
                let callback = |i: usize| -> Result<Rc<Func>> {
                    match args.get(i) {
                        Some(ArrEl::Item(Expr {
                            kind: ExprKind::Func(f),
                            ..
                        })) => Ok(f.clone()),
                        _ => Err(refuse(e.span, "this hook takes a function", "pass an arrow function")),
                    }
                };
                match hook(callee, &hooks) {
                    Some("useEffect") => {
                        if args.len() > 2 {
                            return Err(refuse(
                                e.span,
                                "`useEffect` takes a function and its dependencies",
                                "write `useEffect(() => { … }, [count])`",
                            ));
                        }
                        n += 1;
                        a.watch.push((format!("effect{n}"), callback(0)?));
                    }
                    Some("useMount") => {
                        n += 1;
                        a.init.push((format!("mount{n}"), callback(0)?));
                    }
                    Some("useEvent") => {
                        let event = match args.first() {
                            Some(ArrEl::Item(Expr {
                                kind: ExprKind::Str(s), ..
                            })) if s.chars().all(|c| c.is_ascii_lowercase()) => s.clone(),
                            _ => {
                                return Err(refuse(
                                    e.span,
                                    "`useEvent` takes an event name first",
                                    "write `useEvent(\"resize\", () => { … })`",
                                ));
                            }
                        };
                        let target = match args.get(2) {
                            None => "window".to_string(),
                            Some(ArrEl::Item(Expr {
                                kind: ExprKind::Str(s), ..
                            })) if s == "window" || s == "document" => s.clone(),
                            _ => {
                                return Err(refuse(
                                    e.span,
                                    "`useEvent` listens on \"window\" or \"document\"",
                                    "pass \"document\" as the third argument, or leave it out",
                                ));
                            }
                        };
                        n += 1;
                        let name = format!("on{}{n}", capitalize(&event));
                        a.actions.push((name.clone(), callback(1)?));
                        a.events.push((target, event, name));
                    }
                    Some(other) => {
                        return Err(refuse(
                            e.span,
                            format!("`{other}` returns a value"),
                            format!("assign it: `const x = {other}(…)`"),
                        ));
                    }
                    None => {
                        return Err(refuse(
                            e.span,
                            "a client component's body declares values, hooks and handlers",
                            "move this call into a handler or an effect",
                        ));
                    }
                }
            }
            Stmt::Return(Some(e), _) => {
                // The root carries the directives, so it must be one element the compiler writes.
                let mut root = e;
                while let ExprKind::As(inner, _) | ExprKind::NonNull(inner) = &root.kind {
                    root = inner;
                }
                if !matches!(&root.kind, ExprKind::Jsx(j) if matches!(j.kind, JsxKind::Intrinsic(_))) {
                    return Err(refuse(
                        e.span,
                        "a client component returns one element",
                        "wrap what it returns in an element, e.g. `<div>…</div>`: fragments, components and conditionals can't carry the Interactivity directives",
                    ));
                }
                returned = true;
            }
            Stmt::TypeAlias { .. } => {}
            other => {
                return Err(refuse(
                    crate::compile::stmt_span(other),
                    "a client component's body declares values, hooks and handlers, then returns its element",
                    "move conditionals into derived values and handlers",
                ));
            }
        }
    }
    if !returned {
        return Err(refuse(
            f.span,
            "a client component returns one element",
            "end the body with `return <div>…</div>;`",
        ));
    }
    // The server actions and file buckets this component calls: their endpoints/client go into the store.
    let mut called = BTreeSet::new();
    let mut uploads = BTreeSet::new();
    let mut upload_err: Option<Diag> = None;
    let mut scan = |e: &Expr| {
        if let ExprKind::Call { callee, args, .. } = &e.kind
            && let ExprKind::Ident(n) = &callee.kind
        {
            match a.bindings.get(n) {
                Some(Binding::ServerAction(name)) => {
                    called.insert(name.clone());
                }
                Some(Binding::UploadFile) if upload_err.is_none() => {
                    let bucket_arg = match args.as_slice() {
                        [ArrEl::Item(first), ArrEl::Item(_)]
                        | [ArrEl::Item(first), ArrEl::Item(_), ArrEl::Item(_)] => match &first.kind {
                            ExprKind::Str(b) => Some((b.as_str(), first.span)),
                            ExprKind::Member {
                                obj,
                                prop,
                                optional: false,
                                ..
                            } if matches!(&obj.kind, ExprKind::Ident(api_name) if a.bindings.get(api_name) == Some(&Binding::GeneratedApi)) => {
                                Some((prop.as_str(), first.span))
                            }
                            _ => None,
                        },
                        _ => None,
                    };
                    match bucket_arg {
                        Some((bucket, span)) => {
                            if file_buckets.contains(bucket) {
                                uploads.insert(bucket.to_string());
                            } else {
                                let mut d = Diag::new(span, format!("unknown file bucket `{bucket}`"));
                                if let Some(s) = crate::diag::suggest(bucket, file_buckets.iter().map(String::as_str)) {
                                    d = d.help(format!("did you mean `{s}`?"));
                                } else {
                                    d = d.help("export a private bucket first: `export const inbox = files({ accept, maxBytes })`");
                                }
                                upload_err = Some(d);
                            }
                        }
                        None => {
                            upload_err = Some(refuse(
                                e.span,
                                "`uploadFile` takes `api.<bucket>` (or a bucket name literal), a File/Blob, and optional `{ filename }`",
                                "write `await uploadFile(api.inbox, file)`",
                            ));
                        }
                    }
                }
                _ => {}
            }
        }
    };
    for stmt in body {
        stmt_exprs(stmt, &mut |e| visit_deep(e, &mut scan));
    }
    if let Some(err) = upload_err {
        return Err(err);
    }
    for (_, action) in &a.mutations {
        called.insert(action.clone());
    }
    a.server_actions = called;
    a.file_uploads = uploads;
    Ok(a)
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    c.next()
        .map(|f| f.to_ascii_uppercase().to_string() + c.as_str())
        .unwrap_or_default()
}

impl Analysis {
    /// A `useRef()` no element's `ref` names: its `current` could only ever be null.
    pub fn unattached_ref(&self) -> Option<&str> {
        self.bindings
            .iter()
            .find(|(name, binding)| **binding == Binding::Ref && !self.refs.contains_key(*name))
            .map(|(name, _)| name.as_str())
    }

    /// The directive reference for an identifier used in markup: `context.count`, `state.label`.
    pub fn reference(&self, name: &str) -> Option<String> {
        match self.bindings.get(name)? {
            Binding::State { .. } | Binding::Mutation(_) | Binding::Prop | Binding::Item => {
                Some(format!("context.{name}"))
            }
            Binding::Derived | Binding::Shared => Some(format!("state.{name}")),
            Binding::Action => Some(format!("actions.{name}")),
            _ => None,
        }
    }

    /// The name of the action for a handler expression in markup: a named handler, or a generated
    /// name for an inline arrow (recorded so the store defines it).
    pub fn handler(&mut self, value: &Expr, event: &str) -> Result<String> {
        match &value.kind {
            ExprKind::Ident(n) if self.bindings.get(n) == Some(&Binding::Action) => Ok(n.clone()),
            ExprKind::Func(f) => {
                let key = (value.span.start, value.span.end);
                if let Some(name) = self.inline.get(&key) {
                    return Ok(name.clone());
                }
                let name = format!("{event}{}", self.inline.len() + 1);
                self.inline.insert(key, name.clone());
                self.actions.push((name.clone(), f.clone()));
                Ok(name)
            }
            _ => Err(refuse(
                value.span,
                "an event handler is a function the component defines",
                "write `onClick={() => setCount(count + 1)}` or `onClick={increment}`",
            )),
        }
    }

    /// Whether an expression only reads things the client can recompute: state, props, derived
    /// values, shared state and literals. Directives bind such expressions; anything else is
    /// server-only and rendered once.
    pub fn reactive(&self, e: &Expr) -> bool {
        let mut reads = false;
        let mut ok = true;
        visit(e, &mut |x| match &x.kind {
            ExprKind::Ident(n) => match self.bindings.get(n) {
                Some(
                    Binding::State { .. }
                    | Binding::Mutation(_)
                    | Binding::Prop
                    | Binding::Derived
                    | Binding::Shared
                    | Binding::Item,
                ) => reads = true,
                // A class map is the same on both sides: inlined into the store.
                Some(Binding::Static(_)) | None => {}
                Some(_) => ok = false,
            },
            ExprKind::Jsx(_) | ExprKind::Await(_) | ExprKind::Func(_) => ok = false,
            _ => {}
        });
        reads && ok
    }

    /// The store module (plain JavaScript).
    pub fn store(&self) -> Result<String> {
        let mut out =
            String::from("// Generated by `spacepress build` from a \"use client\" component. Do not edit.\n");
        out.push_str(
            "import { store, getContext, getElement, getConfig, withScope, withSyncEvent } from \"@wordpress/interactivity\";\n\n",
        );
        if !self.live.is_empty() {
            out.push_str("import { live } from \"@spacepress/live\";\n");
        }
        // Server actions and file uploads run through the app's typed client, with the REST root
        // and nonce the page prints for `@spacepress/client`.
        let uses_client = !self.server_actions.is_empty() || !self.file_uploads.is_empty();
        if uses_client {
            out.push_str("import { createClient } from \"@spacepress/client\";\n");
        }
        let _ = writeln!(out, "const ns = {};", js_str(&self.namespace));
        if !self.refs.is_empty() {
            // `ref={name}` rendered `data-sp-ref="name"`. The running directive's element is in
            // this component, so its nearest interactive root is the component's; an element of a
            // nested client component (its own root) is never this component's ref.
            out.push_str("const attached = (name) => {\n  const root = getElement().ref?.closest(\"[data-wp-interactive]\");\n  if (!root) return null;\n  const selector = `[data-sp-ref=\"${name}\"]`;\n  if (root.matches(selector)) return root;\n  for (const element of root.querySelectorAll(selector)) {\n    if (element.closest(\"[data-wp-interactive]\") === root) return element;\n  }\n  return null;\n};\n");
        }
        if uses_client {
            out.push_str("let client;\n");
            if !self.server_actions.is_empty() {
                out.push_str("const call = (name, input) => (client ??= createClient()).actions[name](input);\n");
            }
            if !self.mutations.is_empty() {
                out.push_str(
                    "const __spMutate = async (state, name, input) => {\n  state.pending = true;\n  state.error = undefined;\n  try {\n    return await call(name, input);\n  } catch (e) {\n    state.error = { code: e?.code ?? \"error\", message: e?.message ?? String(e) };\n    throw e;\n  } finally {\n    state.pending = false;\n  }\n};\n",
                );
            }
            if !self.file_uploads.is_empty() {
                out.push_str(
                    "const __spUpload = (bucket, file, opts) => (client ??= createClient()).files[bucket].upload(file, opts);\n",
                );
            }
            out.push('\n');
        }
        let _ = writeln!(out, "const {{ state, actions }} = store(ns, {{");
        out.push_str("  state: {\n");
        for (name, init) in &self.shared {
            let _ = writeln!(out, "    {name}: {},", self.js(init, &Scope::default())?);
        }
        for (name, e) in &self.derived {
            let body = format!("      return {};\n", self.js(e, &Scope::default())?);
            let _ = writeln!(out, "    get {name}() {{\n{}{body}    }},", prologue(&body, "      "));
        }
        out.push_str("  },\n  actions: {\n");
        for (name, f) in &self.actions {
            out.push_str(&self.function(name, f, "    ")?);
        }
        out.push_str("  },\n  callbacks: {\n");
        for (name, f) in self.watch.iter().chain(&self.init) {
            out.push_str(&self.function(name, f, "    ")?);
        }
        // Each `useLive` field subscribes when its element hydrates, to the read whose answer the
        // server put in context (its descriptor and token beside it), and stops when it goes.
        for (field, _, _, _) in &self.live {
            let _ = writeln!(
                out,
                "    live_{field}() {{\n      const context = getContext();\n      return live(context, {});\n    }},",
                js_str(field)
            );
        }
        out.push_str("  },\n});\n");
        Ok(out)
    }

    /// One action or callback: an async handler is a generator (each `await` a `yield`), and a
    /// handler that touches the event's sync-only API is wrapped in `withSyncEvent`.
    fn function(&self, name: &str, f: &Func, pad: &str) -> Result<String> {
        let mut scope = Scope::default();
        let params = self.params(f, &mut scope)?.join(", ");
        scope.awaits = if f.is_async { Awaits::Yield } else { Awaits::Refuse };
        // Defaults run before the function body. Give nontrivial parameters an enclosing scope
        // that already holds the component context and any captured Interactivity scope.
        let wrap = f
            .params
            .iter()
            .any(|p| !matches!(p.pat, Pat::Id(..)) || p.default.is_some());
        let inner = format!("{pad}  ");
        let indent = if wrap { format!("{inner}  ") } else { inner.clone() };
        let body = match &f.body {
            FnBody::Expr(e) => format!("{indent}return {};\n", self.js(e, &scope)?),
            FnBody::Block(stmts) => self.stmts(stmts, &mut scope, &indent)?,
        };
        let source = format!("{params}\n{body}");
        let prologue = prologue(&source, &inner);
        let sync = [
            "preventDefault",
            "stopPropagation",
            "stopImmediatePropagation",
            "currentTarget",
            "dataTransfer",
        ]
        .iter()
        .any(|m| source.contains(&format!(".{m}")));
        let star = if f.is_async { "*" } else { "" };
        let signature = if wrap { "...__spArgs" } else { &params };
        let head = if sync {
            format!("{pad}{name}: withSyncEvent(function{star} ({signature}) {{\n")
        } else {
            format!("{pad}{star}{name}({signature}) {{\n")
        };
        let body = if !wrap {
            body
        } else if f.is_async {
            format!("{inner}return yield* (function* ({params}) {{\n{body}{inner}}})(...__spArgs);\n")
        } else {
            format!("{inner}return (({params}) => {{\n{body}{inner}}})(...__spArgs);\n")
        };
        Ok(format!(
            "{head}{prologue}{body}{pad}}}{},\n",
            if sync { ")" } else { "" }
        ))
    }

    /// Statements one level in from `pad`.
    fn block(&self, stmts: &[Stmt], scope: &mut Scope, pad: &str) -> Result<String> {
        self.stmts(stmts, scope, &format!("{pad}  "))
    }

    /// Statements at `pad`. A binding belongs to the whole block, even before its declaration.
    /// JavaScript itself checks whether a lexical binding has been initialized when it is read.
    fn stmts(&self, stmts: &[Stmt], scope: &mut Scope, pad: &str) -> Result<String> {
        for s in stmts {
            match s {
                Stmt::Func(f) => scope.locals.extend(f.name.clone()),
                Stmt::Decl { pat, .. } => scope.bind_pattern(pat),
                _ => {}
            }
        }
        let mut o = String::new();
        for s in stmts {
            o.push_str(&self.stmt(s, scope, pad)?);
        }
        Ok(o)
    }

    /// A binding pattern (`x`, `{ a, b: [c] }`, `[first, ...rest]`), its names added to `scope`.
    fn pat(&self, p: &Pat, scope: &mut Scope) -> Result<String> {
        Ok(match p {
            Pat::Id(n, _) => {
                scope.locals.insert(n.clone());
                n.clone()
            }
            Pat::Obj { props, rest, .. } => {
                let mut parts = Vec::new();
                for (key, pat) in props {
                    parts.push(format!("{}: {}", js_str(key), self.pat(pat, scope)?));
                }
                if let Some((n, _)) = rest {
                    scope.locals.insert(n.clone());
                    parts.push(format!("...{n}"));
                }
                format!("{{ {} }}", parts.join(", "))
            }
            Pat::Arr { elems, rest, .. } => {
                let mut parts = Vec::new();
                for el in elems {
                    parts.push(match el {
                        Some(pat) => self.pat(pat, scope)?,
                        None => String::new(),
                    });
                }
                if let Some((n, _)) = rest {
                    scope.locals.insert(n.clone());
                    parts.push(format!("...{n}"));
                } else if matches!(elems.last(), Some(None)) {
                    // `[a, ]` is one element; a trailing hole needs its own comma.
                    parts.push(String::new());
                }
                format!("[{}]", parts.join(", "))
            }
            Pat::Default(pat, default) => {
                let value = self.js(default, scope)?;
                format!("{} = {value}", self.pat(pat, scope)?)
            }
        })
    }

    /// A function's parameters, their names added to `scope`: plain names, patterns, defaults
    /// and a rest parameter, as JavaScript writes them.
    fn params(&self, f: &Func, scope: &mut Scope) -> Result<Vec<String>> {
        // The lowerer gives a function that reads `this` a hidden receiver parameter. Client code
        // has no receiver to pass, so it is left out and the read itself is refused.
        let params = if f.receives_this { &f.params[1..] } else { &f.params[..] };
        for p in params {
            scope.bind_pattern(&p.pat);
        }
        let mut out = Vec::new();
        for p in params {
            let mut param = self.pat(&p.pat, scope)?;
            if p.rest {
                param = format!("...{param}");
            } else if let Some(d) = &p.default {
                param = format!("{param} = {}", self.js(d, scope)?);
            }
            out.push(param);
        }
        Ok(out)
    }

    /// `let` and `const` as written. `var` is function-scoped, which the compiled code's blocks
    /// and closures don't model, so it is refused.
    fn decl_kind(kind: DeclKind, span: Span) -> Result<&'static str> {
        match kind {
            DeclKind::Const => Ok("const"),
            DeclKind::Let => Ok("let"),
            DeclKind::Var => Err(refuse(
                span,
                "`var` isn't supported in client code",
                "use `let` or `const`; a `var` is shared by the whole function, so a loop's closures would all see its last value",
            )),
        }
    }

    fn stmt(&self, s: &Stmt, scope: &mut Scope, pad: &str) -> Result<String> {
        Ok(match s {
            Stmt::Expr(e) => format!("{pad}{};\n", self.js(e, scope)?),
            Stmt::Return(None, _) => format!("{pad}return;\n"),
            Stmt::Return(Some(e), _) => format!("{pad}return {};\n", self.js(e, scope)?),
            Stmt::Decl {
                kind, pat, init, span, ..
            } => {
                let k = Self::decl_kind(*kind, *span)?;
                // The loop header calls `stmt` directly, without the block's pre-pass.
                scope.bind_pattern(pat);
                let value = init.as_ref().map(|e| self.js(e, scope)).transpose()?;
                let target = self.pat(pat, scope)?;
                match value {
                    Some(v) => format!("{pad}{k} {target} = {v};\n"),
                    None => format!("{pad}{k} {target};\n"),
                }
            }
            Stmt::For {
                init,
                test,
                update,
                body,
                ..
            } => {
                // Names the header declares belong to the loop.
                let mut inner = scope.clone();
                let head = match init.as_deref() {
                    None => String::new(),
                    Some(Stmt::Block(_)) => {
                        return Err(refuse(
                            crate::compile::stmt_span(s),
                            "a `for` header in a client handler declares one variable",
                            "declare the others before the loop",
                        ));
                    }
                    Some(s) => self
                        .stmt(s, &mut inner, "")?
                        .trim_end()
                        .trim_end_matches(';')
                        .to_string(),
                };
                let test = test
                    .as_ref()
                    .map(|e| self.js(e, &inner))
                    .transpose()?
                    .unwrap_or_default();
                let update = update
                    .as_ref()
                    .map(|e| self.js(e, &inner))
                    .transpose()?
                    .unwrap_or_default();
                let body = self.block(body, &mut inner, pad)?;
                format!("{pad}for ({head}; {test}; {update}) {{\n{body}{pad}}}\n")
            }
            Stmt::ForOf {
                is_await,
                kind,
                pat,
                iter,
                body,
                span,
            } => {
                if *is_await && scope.awaits != Awaits::Await {
                    return Err(refuse(
                        *span,
                        "`for await` runs only inside an async callback here",
                        "await each value in a plain `for (const x of xs)` loop",
                    ));
                }
                let k = Self::decl_kind(*kind, *span)?;
                let iter = self.js(iter, scope)?;
                let mut inner = scope.clone();
                let target = self.pat(pat, &mut inner)?;
                let body = self.block(body, &mut inner, pad)?;
                let each = if *is_await { "for await" } else { "for" };
                format!("{pad}{each} ({k} {target} of {iter}) {{\n{body}{pad}}}\n")
            }
            Stmt::ForIn {
                kind,
                target,
                iter,
                body,
                span,
            } => {
                let iter = self.js(iter, scope)?;
                let mut inner = scope.clone();
                let head = match kind {
                    Some(k) => {
                        let ExprKind::Ident(n) = &target.kind else {
                            unreachable!("a `for … in` declaration binds an identifier")
                        };
                        inner.locals.insert(n.clone());
                        format!("{} {n}", Self::decl_kind(*k, *span)?)
                    }
                    None => {
                        self.assignable(target, &inner)?;
                        self.js(target, &inner)?
                    }
                };
                let body = self.block(body, &mut inner, pad)?;
                format!("{pad}for ({head} in {iter}) {{\n{body}{pad}}}\n")
            }
            Stmt::While(test, body) => {
                let test = self.js(test, scope)?;
                let body = self.block(body, &mut scope.clone(), pad)?;
                format!("{pad}while ({test}) {{\n{body}{pad}}}\n")
            }
            Stmt::DoWhile(body, test) => {
                let body = self.block(body, &mut scope.clone(), pad)?;
                format!("{pad}do {{\n{body}{pad}}} while ({});\n", self.js(test, scope)?)
            }
            Stmt::Break(label, _) => match label {
                Some(l) => format!("{pad}break {l};\n"),
                None => format!("{pad}break;\n"),
            },
            Stmt::Continue(label, _) => match label {
                Some(l) => format!("{pad}continue {l};\n"),
                None => format!("{pad}continue;\n"),
            },
            Stmt::Labeled(label, body, _) => {
                format!("{pad}{label}:\n{}", self.stmt(body, scope, pad)?)
            }
            Stmt::Throw(e) => format!("{pad}throw {};\n", self.js(e, scope)?),
            Stmt::Switch { disc, cases, .. } => {
                let mut o = format!("{pad}switch ({}) {{\n", self.js(disc, scope)?);
                // The cases share one scope, as in JavaScript (the lowerer refuses a `let` or
                // `const` directly under a case); a braced case body is a block with its own.
                let mut inner = scope.clone();
                for (test, body) in cases {
                    match test {
                        Some(t) => o.push_str(&format!("{pad}  case {}:\n", self.js(t, &inner)?)),
                        None => o.push_str(&format!("{pad}  default:\n")),
                    }
                    o.push_str(&self.block(body, &mut inner, &format!("{pad}  "))?);
                }
                o.push_str(&format!("{pad}}}\n"));
                o
            }
            // Every block below has its own scope, cloned from the one around it: what it
            // declares isn't seen after it.
            Stmt::If(c, t, e) => {
                let mut o = format!("{pad}if ({}) {{\n", self.js(c, scope)?);
                o.push_str(&self.block(t, &mut scope.clone(), pad)?);
                o.push_str(&format!("{pad}}}"));
                if let Some(e) = e {
                    o.push_str(" else {\n");
                    o.push_str(&self.block(e, &mut scope.clone(), pad)?);
                    o.push_str(&format!("{pad}}}"));
                }
                o.push('\n');
                o
            }
            Stmt::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                let mut o = format!("{pad}try {{\n");
                o.push_str(&self.block(block, &mut scope.clone(), pad)?);
                o.push_str(&format!("{pad}}}"));
                if let Some(h) = handler {
                    let mut inner = scope.clone();
                    match param {
                        Some((n, _)) => {
                            inner.locals.insert(n.clone());
                            o.push_str(&format!(" catch ({n}) {{\n"));
                        }
                        None => o.push_str(" catch {\n"),
                    }
                    o.push_str(&self.block(h, &mut inner, pad)?);
                    o.push_str(&format!("{pad}}}"));
                }
                if let Some(f) = finalizer {
                    o.push_str(" finally {\n");
                    o.push_str(&self.block(f, &mut scope.clone(), pad)?);
                    o.push_str(&format!("{pad}}}"));
                }
                o.push('\n');
                o
            }
            Stmt::Block(b) => format!("{pad}{{\n{}{pad}}}\n", self.block(b, &mut scope.clone(), pad)?),
            // Its name is already in scope: see [`Self::stmts`].
            Stmt::Func(f) => format!("{pad}{}\n", self.callback(f, scope, pad)?),
            other => {
                return Err(refuse(
                    crate::compile::stmt_span(other),
                    "this statement isn't supported in a client handler yet",
                    "use expressions, declarations, `if`, loops, `switch`, `try`, `throw` and `return` in handlers",
                ));
            }
        })
    }

    /// One expression in JavaScript, with references rewritten to the store.
    pub fn js(&self, e: &Expr, scope: &Scope) -> Result<String> {
        let js = |x: &Expr| self.js(x, scope);
        Ok(match &e.kind {
            ExprKind::Num(n) => crate::num::js_number_to_string(*n),
            ExprKind::Str(s) => js_str(s),
            ExprKind::Bool(b) => b.to_string(),
            ExprKind::Null => "null".into(),
            ExprKind::Undefined => "undefined".into(),
            ExprKind::Template(quasis, exprs) => {
                let mut o = String::from("`");
                for (i, q) in quasis.iter().enumerate() {
                    o.push_str(&q.replace('\\', "\\\\").replace('`', "\\`").replace("${", "\\${"));
                    if let Some(x) = exprs.get(i) {
                        o.push_str(&format!("${{{}}}", js(x)?));
                    }
                }
                o.push('`');
                o
            }
            ExprKind::Ident(n) if n == "this" => {
                return Err(refuse(
                    e.span,
                    "`this` isn't supported in client code",
                    "handlers and callbacks here have no receiver; read the element from the event (`event.currentTarget`) or a `useRef()`",
                ));
            }
            ExprKind::Ident(n) if n == "arguments" => {
                return Err(refuse(
                    e.span,
                    "`arguments` isn't supported in client code",
                    "name the parameters, or collect them with a rest parameter: `(...args) => …`",
                ));
            }
            ExprKind::Ident(n) if scope.locals.contains(n) => n.clone(),
            ExprKind::Ident(n) => match self.bindings.get(n) {
                Some(Binding::State { .. } | Binding::Mutation(_) | Binding::Prop | Binding::Item) => {
                    format!("context.{n}")
                }
                // A derived value's getter reads `getContext()`, and a handler reads it when it
                // runs: in a callback that may run later, each read goes through the scope the
                // enclosing handler captured.
                Some(Binding::Derived) => scope.scoped(format!("state.{n}")),
                Some(Binding::Shared) => format!("state.{n}"),
                Some(Binding::Ref) => format!("({{ current: {} }})", scope.scoped(format!("attached({})", js_str(n)))),
                Some(Binding::Static(js)) => format!("({js})"),
                // The store hands out each action bound to the scope it is read in, so
                // `setTimeout(bump, 10)` runs `bump` with this component's context.
                Some(Binding::Action) => scope.scoped(format!("actions.{n}")),
                Some(Binding::GeneratedApi) => {
                    return Err(refuse(
                        e.span,
                        format!("`{n}` from `_generated/api` is passed to `useLive(...)` or `useMutation(...)`"),
                        "write `useLive(api.<kind>.list(...))` or `useMutation(api.actions.<name>)`",
                    ));
                }
                Some(Binding::Setter { .. } | Binding::ServerAction(_) | Binding::UploadFile) => {
                    return Err(refuse(
                        e.span,
                        format!("`{n}` can only be called"),
                        format!("write `{n}(…)`"),
                    ));
                }
                None if self.is_global(n) => n.clone(),
                None => {
                    return Err(refuse(
                        e.span,
                        format!("`{n}` isn't available in the browser"),
                        "a client component reads its props, state, derived values and shared state; pass other data as a prop",
                    ));
                }
            },
            ExprKind::Array(items) => format!(
                "[{}]",
                items
                    .iter()
                    .map(|i| self.arr_el(i, scope))
                    .collect::<Result<Vec<_>>>()?
                    .join(", ")
            ),
            ExprKind::Object(props) => {
                let mut parts = Vec::new();
                for p in props {
                    parts.push(match p {
                        Prop::KV(PropKey::Static(k), v) => format!("{}: {}", js_str(k), js(v)?),
                        Prop::KV(PropKey::Computed(k), v) => format!("[{}]: {}", js(k)?, js(v)?),
                        Prop::Spread(v) => format!("...{}", js(v)?),
                        Prop::NullPrototype => "__proto__: null".into(),
                    });
                }
                format!("({{ {} }})", parts.join(", "))
            }
            ExprKind::Unary(op, x) => {
                let o = match op {
                    UnOp::Neg => "-",
                    UnOp::Plus => "+",
                    UnOp::Not => "!",
                    UnOp::TypeOf => "typeof ",
                    UnOp::BitNot => "~",
                };
                format!("({o}{})", js(x)?)
            }
            ExprKind::Binary(op, l, r) => format!("({} {} {})", js(l)?, binop(*op), js(r)?),
            ExprKind::IsNullish(x, negated) => format!("({} {} null)", js(x)?, if *negated { "!=" } else { "==" }),
            ExprKind::Logical(op, l, r) => {
                let o = match op {
                    LogOp::And => "&&",
                    LogOp::Or => "||",
                    LogOp::Nullish => "??",
                };
                format!("({} {o} {})", js(l)?, js(r)?)
            }
            ExprKind::Cond(c, t, f) => format!("({} ? {} : {})", js(c)?, js(t)?, js(f)?),
            ExprKind::Sequence(xs) => format!("({})", xs.iter().map(js).collect::<Result<Vec<_>>>()?.join(", ")),
            ExprKind::Member {
                obj, prop, optional, ..
            } => format!("{}{}{prop}", js(obj)?, if *optional { "?." } else { "." }),
            ExprKind::Index { obj, index, optional } => {
                format!("{}{}[{}]", js(obj)?, if *optional { "?." } else { "" }, js(index)?)
            }
            ExprKind::Chain(x) | ExprKind::NonNull(x) | ExprKind::As(x, _) => js(x)?,
            ExprKind::Await(x) => match scope.awaits {
                Awaits::Yield => format!("(yield {})", js(x)?),
                Awaits::Await => format!("(await {})", js(x)?),
                Awaits::Refuse => {
                    return Err(refuse(
                        e.span,
                        "`await` is only valid in an async function",
                        "mark the function that awaits `async`",
                    ));
                }
            },
            ExprKind::In(k, o) => format!("({} in {})", js(k)?, js(o)?),
            ExprKind::Instanceof(l, r) => format!("({} instanceof {})", js(l)?, js(r)?),
            ExprKind::Assign { op, target, value } => {
                let o = match op {
                    None => "=".to_string(),
                    Some(AssignOp::Bin(b)) => format!("{}=", binop(*b)),
                    Some(AssignOp::Log(LogOp::And)) => "&&=".into(),
                    Some(AssignOp::Log(LogOp::Or)) => "||=".into(),
                    Some(AssignOp::Log(LogOp::Nullish)) => "??=".into(),
                };
                self.assignable(target, scope)?;
                format!("({} {o} {})", js(target)?, js(value)?)
            }
            ExprKind::Update { inc, prefix, target } => {
                self.assignable(target, scope)?;
                let o = if *inc { "++" } else { "--" };
                if *prefix {
                    format!("({o}{})", js(target)?)
                } else {
                    format!("({}{o})", js(target)?)
                }
            }
            ExprKind::Call {
                callee, args, optional, ..
            } => {
                let argv = || -> Result<String> {
                    Ok(args
                        .iter()
                        .map(|a| self.arr_el(a, scope))
                        .collect::<Result<Vec<_>>>()?
                        .join(", "))
                };
                match &callee.kind {
                    ExprKind::Ident(n) if !scope.locals.contains(n) => match self.bindings.get(n) {
                        Some(Binding::Setter { field }) => {
                            let [ArrEl::Item(v)] = args.as_slice() else {
                                return Err(refuse(
                                    e.span,
                                    format!("`{n}` takes the new value"),
                                    format!("write `{n}(next)`"),
                                ));
                            };
                            if let ExprKind::Func(f) = &v.kind {
                                // `setCount((c) => c + 1)`: the updater sees the current value.
                                let [p] = f.params.as_slice() else {
                                    return Err(refuse(
                                        v.span,
                                        "an updater takes the current value",
                                        format!("write `{n}((value) => …)`"),
                                    ));
                                };
                                let Pat::Id(pn, _) = &p.pat else {
                                    return Err(refuse(
                                        v.span,
                                        "an updater takes the current value",
                                        format!("write `{n}((value) => …)`"),
                                    ));
                                };
                                // The updater is a plain arrow: `await` can't go in it.
                                let mut inner = Scope {
                                    awaits: Awaits::Refuse,
                                    ..scope.clone()
                                };
                                inner.locals.insert(pn.clone());
                                let FnBody::Expr(body) = &f.body else {
                                    return Err(refuse(
                                        v.span,
                                        "an updater returns the next value",
                                        format!("write `{n}((value) => value + 1)`"),
                                    ));
                                };
                                format!(
                                    "(context.{field} = (({pn}) => {})(context.{field}))",
                                    self.js(body, &inner)?
                                )
                            } else {
                                format!("(context.{field} = {})", js(v)?)
                            }
                        }
                        Some(Binding::ServerAction(action)) => {
                            let input = match args.as_slice() {
                                [] => "undefined".to_string(),
                                [ArrEl::Item(x)] => js(x)?,
                                _ => {
                                    return Err(refuse(
                                        e.span,
                                        format!("`{n}` takes one input object"),
                                        format!("write `{n}({{ … }})`"),
                                    ));
                                }
                            };
                            format!("call({}, {input})", js_str(action))
                        }
                        Some(Binding::UploadFile) => match args.as_slice() {
                            [
                                ArrEl::Item(Expr {
                                    kind: ExprKind::Str(bucket),
                                    ..
                                }),
                                ArrEl::Item(file),
                            ] => format!("__spUpload({}, {})", js_str(bucket), js(file)?),
                            [
                                ArrEl::Item(Expr {
                                    kind: ExprKind::Str(bucket),
                                    ..
                                }),
                                ArrEl::Item(file),
                                ArrEl::Item(opts),
                            ] => format!("__spUpload({}, {}, {})", js_str(bucket), js(file)?, js(opts)?),
                            [
                                ArrEl::Item(Expr {
                                    kind: ExprKind::Member { obj, prop: bucket, optional: false, .. },
                                    ..
                                }),
                                ArrEl::Item(file),
                            ] if matches!(&obj.kind, ExprKind::Ident(api_name) if self.bindings.get(api_name) == Some(&Binding::GeneratedApi)) => {
                                format!("__spUpload({}, {})", js_str(bucket), js(file)?)
                            }
                            [
                                ArrEl::Item(Expr {
                                    kind: ExprKind::Member { obj, prop: bucket, optional: false, .. },
                                    ..
                                }),
                                ArrEl::Item(file),
                                ArrEl::Item(opts),
                            ] if matches!(&obj.kind, ExprKind::Ident(api_name) if self.bindings.get(api_name) == Some(&Binding::GeneratedApi)) => {
                                format!("__spUpload({}, {}, {})", js_str(bucket), js(file)?, js(opts)?)
                            }
                            _ => {
                                return Err(refuse(
                                    e.span,
                                    "`uploadFile` takes `api.<bucket>` (or a bucket name literal), a File/Blob, and optional `{ filename }`",
                                    "write `await uploadFile(api.inbox, file)`",
                                ));
                            }
                        },
                        // Another handler of this component, called through the store as the
                        // runtime calls it: a plain one returns its value, an async one (a
                        // generator) a Promise, which an `await` around the call waits for.
                        Some(Binding::Action) => format!("{}({})", scope.scoped(format!("actions.{n}")), argv()?),
                        _ => format!("{}{}({})", js(callee)?, if *optional { "?." } else { "" }, argv()?),
                    },
                    ExprKind::Member {
                        obj,
                        prop,
                        optional: false,
                        ..
                    } if matches!(&obj.kind, ExprKind::Ident(n) if !scope.locals.contains(n) && matches!(self.bindings.get(n), Some(Binding::Mutation(_)))) =>
                    {
                        let ExprKind::Ident(n) = &obj.kind else { unreachable!() };
                        let Some(Binding::Mutation(action)) = self.bindings.get(n) else {
                            unreachable!()
                        };
                        match prop.as_str() {
                            "mutate" => {
                                let input = match args.as_slice() {
                                    [] => "undefined".to_string(),
                                    [ArrEl::Item(x)] => js(x)?,
                                    _ => {
                                        return Err(refuse(
                                            e.span,
                                            format!("`{n}.mutate` takes at most one input object"),
                                            format!("write `{n}.mutate({{ … }})`"),
                                        ));
                                    }
                                };
                                format!("__spMutate(context.{n}, {}, {input})", js_str(action))
                            }
                            "reset" => format!("(context.{n}.error = undefined)"),
                            _ => {
                                return Err(refuse(
                                    e.span,
                                    format!(
                                        "`{n}` has `.mutate(...)`, `.reset()`, `.pending`, and `.error`, not `.{prop}()`"
                                    ),
                                    format!("write `await {n}.mutate(...)`"),
                                ));
                            }
                        }
                    }
                    _ => format!("{}{}({})", js(callee)?, if *optional { "?." } else { "" }, argv()?),
                }
            }
            ExprKind::Func(f) => format!("({})", self.callback(f, scope, "    ")?),
            ExprKind::New { callee, args, .. } => {
                format!(
                    "new {}({})",
                    js(callee)?,
                    args.iter()
                        .map(|a| self.arr_el(a, scope))
                        .collect::<Result<Vec<_>>>()?
                        .join(", ")
                )
            }
            ExprKind::Regex { pattern, flags } => format!("/{pattern}/{flags}"),
            ExprKind::Jsx(_) => {
                return Err(refuse(
                    e.span,
                    "JSX inside a handler or derived value isn't supported",
                    "render markup in the component's return",
                ));
            }
            _ => {
                return Err(refuse(
                    e.span,
                    "this expression isn't supported in client code yet",
                    "use plain expressions on state, props and derived values",
                ));
            }
        })
    }

    /// A function inside a handler, an arrow or a `function`, at `pad`.
    fn callback(&self, f: &Func, scope: &Scope, pad: &str) -> Result<String> {
        if f.is_generator {
            return Err(refuse(
                f.span,
                "a generator function inside a handler isn't supported",
                "write an ordinary or async callback",
            ));
        }
        // A nested callback is a real JavaScript function: inside an async one `await` stays
        // `await`; only the handler itself is a generator that yields. It may run after the
        // handler returns (a timer, a listener, a promise callback), when the runtime has no
        // scope, so what needs one goes through the handler's.
        let mut inner = Scope {
            awaits: if f.is_async { Awaits::Await } else { Awaits::Refuse },
            deferred: true,
            ..scope.clone()
        };
        let params = self.params(f, &mut inner)?.join(", ");
        let a = if f.is_async { "async " } else { "" };
        // `this` and `arguments` are refused, so the two kinds differ only in a function's name.
        let head = if f.is_arrow {
            format!("{a}({params}) =>")
        } else {
            format!("{a}function {}({params})", f.name.as_deref().unwrap_or_default())
        };
        Ok(match &f.body {
            FnBody::Expr(b) => format!("{head} {}", self.js(b, &inner)?),
            FnBody::Block(stmts) => format!("{head} {{\n{}{pad}}}", self.block(stmts, &mut inner, pad)?),
        })
    }

    fn arr_el(&self, a: &ArrEl, scope: &Scope) -> Result<String> {
        Ok(match a {
            ArrEl::Item(x) => self.js(x, scope)?,
            ArrEl::Spread(x) => format!("...{}", self.js(x, scope)?),
        })
    }

    /// A name the browser itself has: a JavaScript or browser global the module doesn't shadow.
    fn is_global(&self, n: &str) -> bool {
        BROWSER_GLOBALS.contains(&n) && !self.module_names.contains(n)
    }

    /// State changes go through setters, so markup and effects always see the context's value.
    fn assignable(&self, target: &Expr, scope: &Scope) -> Result<()> {
        let mut root = target;
        while let ExprKind::Member { obj, .. } | ExprKind::Index { obj, .. } = &root.kind {
            root = obj;
        }
        if let ExprKind::Ident(n) = &root.kind
            && !scope.locals.contains(n)
        {
            return match self.bindings.get(n) {
                Some(Binding::State { setter: Some(s) }) if std::ptr::eq(root, target) => Err(refuse(
                    target.span,
                    format!("`{n}` changes through `{s}`"),
                    format!("write `{s}(next)`"),
                )),
                Some(Binding::Shared) => Ok(()),
                // `window.location.href = url`, `document.title = t`: a property of the page, not
                // the component's state. The global itself is never reassigned.
                None if self.is_global(n) && !std::ptr::eq(root, target) => Ok(()),
                Some(Binding::State { .. } | Binding::Prop) if !std::ptr::eq(root, target) => Err(refuse(
                    target.span,
                    format!("changing a field of `{n}` in place isn't seen by React"),
                    "set a new value with the setter instead",
                )),
                _ => Err(refuse(
                    target.span,
                    format!("`{n}` can't be assigned here"),
                    "keep changing values in `useState`",
                )),
            };
        }
        Ok(())
    }
}

/// Locals declared inside a handler, and what `await` compiles to where the code runs.
#[derive(Debug, Default, Clone)]
pub struct Scope {
    pub locals: BTreeSet<String>,
    pub awaits: Awaits,
    /// Inside a callback nested in a handler, which may run after the handler has returned.
    pub deferred: bool,
}

/// The name of the scope a handler captures for its nested callbacks: see [`prologue`].
const SCOPED: &str = "__spScope";

impl Scope {
    fn bind_pattern(&mut self, pat: &Pat) {
        let mut names = Vec::new();
        pat.bindings(&mut names);
        self.locals.extend(names.into_iter().map(|(name, _)| name.to_string()));
    }

    /// An expression that calls `getContext()` or `getElement()` when it runs (a derived value,
    /// an action, a ref). The runtime has a scope while a handler runs, but not in a timer,
    /// listener or promise callback it set up; there the expression runs in the handler's scope.
    fn scoped(&self, js: String) -> String {
        if self.deferred {
            format!("{SCOPED}(() => {js})")
        } else {
            js
        }
    }
}

/// What an action, callback or derived getter starts with: the context it reads, and, when a
/// nested callback needs it, the runtime's scope captured while it is live (`withScope`).
fn prologue(body: &str, pad: &str) -> String {
    let mut o = format!("{pad}const context = getContext();\n");
    if body.contains(&format!("{SCOPED}(")) {
        let _ = writeln!(o, "{pad}const {SCOPED} = withScope((read) => read());");
    }
    o
}

/// What `await x` compiles to.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum Awaits {
    /// Outside any async function (a derived value, a plain handler or callback): an error.
    #[default]
    Refuse,
    /// In an async handler, which the Interactivity runtime runs as a generator: `(yield x)`.
    Yield,
    /// In an async callback nested inside a handler, an ordinary async function: `(await x)`.
    Await,
}

/// Globals a client component may name: the JavaScript built-ins and the browser APIs a React
/// component reaches for. A prop, state value or local of the same name is found first.
const BROWSER_GLOBALS: &[&str] = &[
    // JavaScript
    "undefined",
    "NaN",
    "Infinity",
    "globalThis",
    "Math",
    "JSON",
    "Number",
    "String",
    "Boolean",
    "Array",
    "Object",
    "Date",
    "Promise",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "Symbol",
    "RegExp",
    "Error",
    "TypeError",
    "RangeError",
    "Intl",
    "parseInt",
    "parseFloat",
    "isNaN",
    "isFinite",
    "encodeURIComponent",
    "decodeURIComponent",
    "encodeURI",
    "decodeURI",
    "structuredClone",
    "queueMicrotask",
    "console",
    // The browser
    "window",
    "document",
    "navigator",
    "location",
    "history",
    "localStorage",
    "sessionStorage",
    "fetch",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "matchMedia",
    "getComputedStyle",
    "IntersectionObserver",
    "ResizeObserver",
    "MutationObserver",
    "URL",
    "URLSearchParams",
    "AbortController",
    "TextEncoder",
    "TextDecoder",
    "FormData",
    "Headers",
    "Blob",
    "File",
    "HTMLElement",
    "HTMLInputElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "KeyboardEvent",
    "MouseEvent",
];

fn binop(op: BinOp) -> &'static str {
    match op {
        BinOp::Add => "+",
        BinOp::Sub => "-",
        BinOp::Mul => "*",
        BinOp::Div => "/",
        BinOp::Rem => "%",
        BinOp::Exp => "**",
        BinOp::Lt => "<",
        BinOp::Le => "<=",
        BinOp::Gt => ">",
        BinOp::Ge => ">=",
        BinOp::Eq => "===",
        BinOp::Ne => "!==",
        BinOp::LooseEq => "==",
        BinOp::LooseNe => "!=",
        BinOp::BitAnd => "&",
        BinOp::BitOr => "|",
        BinOp::BitXor => "^",
        BinOp::Shl => "<<",
        BinOp::Shr => ">>",
        BinOp::UShr => ">>>",
    }
}

pub fn js_str(s: &str) -> String {
    serde_json::to_string(s).expect("JSON string").replace('<', "\\u003c")
}

/// Every expression below `e`, `e` first.
pub fn visit(e: &Expr, f: &mut dyn FnMut(&Expr)) {
    f(e);
    let mut go = |x: &Expr| visit(x, f);
    match &e.kind {
        ExprKind::Template(_, xs) | ExprKind::Sequence(xs) => xs.iter().for_each(&mut go),
        ExprKind::Array(items) => items.iter().for_each(|i| match i {
            ArrEl::Item(x) | ArrEl::Spread(x) => go(x),
        }),
        ExprKind::Object(props) => props.iter().for_each(|p| match p {
            Prop::KV(PropKey::Computed(k), v) => {
                go(k);
                go(v)
            }
            Prop::KV(_, v) | Prop::Spread(v) => go(v),
            Prop::NullPrototype => {}
        }),
        ExprKind::Unary(_, x)
        | ExprKind::IsNullish(x, _)
        | ExprKind::Chain(x)
        | ExprKind::NonNull(x)
        | ExprKind::As(x, _)
        | ExprKind::Await(x)
        | ExprKind::Delete(x) => go(x),
        ExprKind::Binary(_, l, r) | ExprKind::Logical(_, l, r) | ExprKind::In(l, r) | ExprKind::Instanceof(l, r) => {
            go(l);
            go(r)
        }
        ExprKind::Cond(c, t, x) => {
            go(c);
            go(t);
            go(x)
        }
        ExprKind::Member { obj, .. } => go(obj),
        ExprKind::Index { obj, index, .. } => {
            go(obj);
            go(index)
        }
        ExprKind::Call { callee, args, .. } | ExprKind::New { callee, args, .. } => {
            go(callee);
            args.iter().for_each(|a| match a {
                ArrEl::Item(x) | ArrEl::Spread(x) => go(x),
            })
        }
        ExprKind::Assign { target, value, .. } => {
            go(target);
            go(value)
        }
        ExprKind::Update { target, .. } => go(target),
        ExprKind::Jsx(j) => j.exprs().into_iter().for_each(&mut go),
        _ => {}
    }
}

/// Every expression a statement holds, including inside nested function bodies.
fn stmt_exprs(s: &Stmt, f: &mut dyn FnMut(&Expr)) {
    match s {
        Stmt::Decl { init: Some(e), .. } | Stmt::Expr(e) | Stmt::Return(Some(e), _) | Stmt::Throw(e) => f(e),
        Stmt::If(c, t, e) => {
            f(c);
            t.iter().for_each(|s| stmt_exprs(s, f));
            e.iter().flatten().for_each(|s| stmt_exprs(s, f));
        }
        Stmt::Block(b) => b.iter().for_each(|s| stmt_exprs(s, f)),
        Stmt::For {
            init,
            test,
            update,
            body,
            ..
        } => {
            init.iter().for_each(|s| stmt_exprs(s, f));
            test.iter().chain(update).for_each(&mut *f);
            body.iter().for_each(|s| stmt_exprs(s, f));
        }
        Stmt::ForOf { iter, body, .. } => {
            f(iter);
            body.iter().for_each(|s| stmt_exprs(s, f));
        }
        Stmt::ForIn { target, iter, body, .. } => {
            f(target);
            f(iter);
            body.iter().for_each(|s| stmt_exprs(s, f));
        }
        Stmt::While(test, body) | Stmt::DoWhile(body, test) => {
            f(test);
            body.iter().for_each(|s| stmt_exprs(s, f));
        }
        Stmt::Labeled(_, body, _) => stmt_exprs(body, f),
        Stmt::Switch { disc, cases, .. } => {
            f(disc);
            for (test, body) in cases {
                test.iter().for_each(&mut *f);
                body.iter().for_each(|s| stmt_exprs(s, f));
            }
        }
        Stmt::Try {
            block,
            handler,
            finalizer,
            ..
        } => {
            block
                .iter()
                .chain(handler.iter().flatten())
                .chain(finalizer.iter().flatten())
                .for_each(|s| stmt_exprs(s, f));
        }
        Stmt::Func(func) => func_exprs(func, f),
        _ => {}
    }
}

fn pattern_defaults(pat: &Pat, f: &mut dyn FnMut(&Expr)) {
    match pat {
        Pat::Default(pat, default) => {
            f(default);
            pattern_defaults(pat, f);
        }
        Pat::Obj { props, .. } => props.iter().for_each(|(_, pat)| pattern_defaults(pat, f)),
        Pat::Arr { elems, .. } => elems.iter().flatten().for_each(|pat| pattern_defaults(pat, f)),
        Pat::Id(..) => {}
    }
}

fn func_exprs(func: &Func, f: &mut dyn FnMut(&Expr)) {
    for param in &func.params {
        param.default.iter().for_each(&mut *f);
        pattern_defaults(&param.pat, f);
    }
    match &func.body {
        FnBody::Expr(e) => f(e),
        FnBody::Block(b) => b.iter().for_each(|s| stmt_exprs(s, f)),
    }
}

/// [`visit`], descending into function bodies too.
fn visit_deep(e: &Expr, f: &mut dyn FnMut(&Expr)) {
    visit(e, &mut |x| {
        f(x);
        if let ExprKind::Func(func) = &x.kind {
            func_exprs(func, &mut |y| visit_deep(y, f));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The store module for the component `source` exports, or the first refusal's message.
    fn store(source: &str) -> std::result::Result<String, String> {
        let dir = tempfile::tempdir().unwrap();
        let entry = dir.path().join("spacepress.config.ts");
        std::fs::write(&entry, "export default {};\n").unwrap();
        std::fs::create_dir_all(dir.path().join("sp/components")).unwrap();
        std::fs::write(
            dir.path().join("sp/components/A.tsx"),
            format!("\"use client\";\n{source}\n"),
        )
        .unwrap();
        let program = crate::loader::load(&entry).map_err(|d| d.message)?;
        let (_, id) = program.components.first().expect("the component module");
        let module = &program.modules[*id];
        let func = module
            .body
            .iter()
            .find_map(|s| match s {
                Stmt::Exported(inner) => match &**inner {
                    Stmt::Func(f) => Some(f.clone()),
                    _ => None,
                },
                _ => None,
            })
            .expect("an exported component");
        let analysis = analyse(
            "app/A".into(),
            &func,
            module,
            &program,
            &BTreeSet::new(),
            &BTreeSet::new(),
            &[],
        )
        .map_err(|d| d.message)?;
        analysis.store().map_err(|d| d.message)
    }

    const IMPORTS: &str =
        "import { useState } from \"react\";\nimport { useMount, useEvent } from \"spacepress/react\";";

    #[test]
    fn handlers_compile_loops_switch_labels_and_throw() {
        let out = store(&format!(
            "{IMPORTS}
export function A({{ items }}: {{ items: number[] }}) {{
  const [n, setN] = useState(0);
  useMount(() => {{
    let total = 0;
    for (let i = 0; i < items.length; i++) {{ if (items[i] < 0) continue; total += items[i]; }}
    for (const [k, v] of Object.entries({{ a: 1 }})) {{ total += v; }}
    for (const {{ x, y = n }} of [{{ x: 1 }}]) {{ total += x + y; }}
    for (const key in {{ a: 1 }}) {{ if (key === \"a\") break; }}
    outer: for (const a of items) {{ for (const b of items) {{ if (a === b) continue outer; break outer; }} }}
    while (total > 100) {{ total -= 1; }}
    do {{ total++; }} while (total < 0);
    switch (total) {{ case 0: setN(0); break; default: {{ setN(total); }} }}
    if (total < -1) throw new Error(\"negative\");
  }});
  return <b>{{n}}</b>;
}}"
        ))
        .unwrap();
        for expected in [
            "for (let i = 0; (i < context.items.length); (i++)) {",
            "continue;",
            "for (const [k, v] of Object.entries(",
            "for (const { \"x\": x, \"y\": y = context.n } of",
            "for (const key in ({ \"a\": 1 })) {",
            "outer:\n",
            "continue outer;",
            "break outer;",
            "while ((total > 100)) {",
            "} while ((total < 0));",
            "switch (total) {",
            "case 0:",
            "default:",
            "throw new Error(\"negative\");",
        ] {
            assert!(out.contains(expected), "{expected:?} in:\n{out}");
        }
    }

    #[test]
    fn async_callbacks_inside_handlers_await_and_the_handler_yields() {
        let out = store(&format!(
            "{IMPORTS}
export function A({{ label }}: {{ label: string }}) {{
  const [open, setOpen] = useState(false);
  useEvent(\"keydown\", async (event) => {{
    const res = await fetch(\"/x.json\");
    document.body.addEventListener(\"click\", async () => {{
      await navigator.clipboard.writeText(label);
      setTimeout(() => {{ document.title = label; }}, 10);
    }});
    if (res.ok) window.location.href = \"/next\";
    setOpen(!open);
  }}, \"document\");
  return <b>{{open ? 1 : 0}}</b>;
}}"
        ))
        .unwrap();
        assert!(out.contains("*onKeydown1(event) {"), "{out}");
        assert!(out.contains("const res = (yield fetch(\"/x.json\"));"), "{out}");
        assert!(out.contains("(async () => {"), "{out}");
        assert!(
            out.contains("(await navigator.clipboard.writeText(context.label));"),
            "{out}"
        );
        assert!(out.contains("(window.location.href = \"/next\")"), "{out}");
        assert!(out.contains("(document.title = context.label)"), "{out}");
    }

    #[test]
    fn browser_globals_yield_to_the_components_own_names() {
        // A prop named like a global is the prop.
        let out = store(&format!(
            "{IMPORTS}
export function A({{ location }}: {{ location: string }}) {{
  const [n, setN] = useState(0);
  useMount(() => {{ setN(parseInt(location, 10)); localStorage.setItem(\"k\", String(n)); }});
  return <b>{{n}}</b>;
}}"
        ))
        .unwrap();
        assert!(out.contains("parseInt(context.location, 10)"), "{out}");
        assert!(out.contains("localStorage.setItem("), "{out}");
        // A module-level name that shadows a global is the server's, not the browser's.
        let err = store(&format!(
            "{IMPORTS}
const fetch = 1;
export function A() {{ const [n, setN] = useState(0); useMount(() => {{ setN(fetch); }}); return <b>{{n}}</b>; }}"
        ))
        .unwrap_err();
        assert!(err.contains("`fetch` isn't available in the browser"), "{err}");
    }

    /// The reviewer's case: a timer and a listener a mount effect sets up run after it returns,
    /// when the runtime has no scope, and read a derived value and call another handler.
    #[test]
    fn deferred_callbacks_read_derived_values_and_handlers_through_the_handlers_scope() {
        let out = store(
            "import { useRef, useState } from \"react\";
import { useMount } from \"spacepress/react\";
export function A() {
  const [n, setN] = useState(0);
  const doubled = n * 2;
  const box = useRef();
  const bump = () => setN(n + 1);
  useMount(() => {
    setTimeout(() => setN(doubled), 10);
    document.body.addEventListener(\"click\", () => bump());
    setTimeout(bump, 20);
    Promise.resolve().then(() => { box.current?.focus(); });
    setN(doubled);
  });
  return <b ref={box}>{n}</b>;
}",
        )
        .unwrap();
        assert!(out.contains("withScope, withSyncEvent } from"), "{out}");
        assert!(out.contains("const __spScope = withScope((read) => read());"), "{out}");
        // In the callbacks: through the captured scope.
        assert!(out.contains("(context.n = __spScope(() => state.doubled))"), "{out}");
        assert!(out.contains("__spScope(() => actions.bump)()"), "{out}");
        assert!(out.contains("__spScope(() => attached(\"box\"))"), "{out}");
        // A handler passed as a value is the store's, bound to the scope it is read in.
        assert!(out.contains("setTimeout(actions.bump, 20)"), "{out}");
        // In the handler itself the scope is live: a plain read.
        assert!(out.contains("      (context.n = state.doubled);"), "{out}");
        // A handler with no deferred callback captures nothing.
        let bump = out.split("bump() {").nth(1).unwrap().split("},").next().unwrap();
        assert!(!bump.contains("withScope"), "{bump}");
    }

    #[test]
    fn handlers_call_each_other_through_the_store() {
        let out = store(&format!(
            "{IMPORTS}
export function A() {{
  const [n, setN] = useState(0);
  const bump = () => {{ setN(n + 1); return n + 1; }};
  const load = async () => {{ await fetch(\"/x\"); bump(); return 7; }};
  const later = async () => {{ const got = await load(); setN(got + bump()); }};
  const now = () => {{ load(); bump(); }};
  return <b onClick={{later}} onKeyDown={{now}}>{{n}}</b>;
}}"
        ))
        .unwrap();
        assert!(!out.contains("yield*"), "{out}");
        // An async handler's result is a Promise the caller's `await` waits for.
        assert!(out.contains("const got = (yield actions.load());"), "{out}");
        assert!(out.contains("(context.n = (got + actions.bump()))"), "{out}");
        assert!(out.contains("      actions.load();\n      actions.bump();"), "{out}");
    }

    #[test]
    fn this_and_arguments_are_refused_and_function_expressions_stay_functions() {
        for (body, refusal) in [
            (
                "useMount(() => { document.body.addEventListener(\"click\", function () { this.remove(); }); });",
                "`this` isn't supported in client code",
            ),
            (
                "useMount(() => { [1].forEach(() => console.log(this)); });",
                "`this` isn't supported in client code",
            ),
            (
                "useMount(() => { [1].forEach(function () { console.log(arguments.length); }); });",
                "`arguments` isn't supported in client code",
            ),
        ] {
            let err = store(&format!(
                "{IMPORTS}
export function A() {{ const [n, setN] = useState(0); {body} return <b>{{n}}</b>; }}"
            ))
            .unwrap_err();
            assert!(err.contains(refusal), "{body}: expected {refusal:?}, got {err:?}");
        }
        let out = store(&format!(
            "{IMPORTS}
export function A() {{
  const [n, setN] = useState(0);
  useMount(() => {{ [1].forEach(function each(x) {{ setN(x); }}); setTimeout(async function () {{ await fetch(\"/\"); }}); }});
  return <b>{{n}}</b>;
}}"
        ))
        .unwrap();
        // A named function expression is lowered to a declaration in its own scope, returned.
        assert!(out.contains("function each(x) {"), "{out}");
        assert!(out.contains("setTimeout((async function () {"), "{out}");
        assert!(!out.contains("(this)"), "{out}");
    }

    #[test]
    fn a_const_function_sees_its_own_name() {
        let out = store(&format!(
            "{IMPORTS}
export function A({{ items }}: {{ items: number[] }}) {{
  const [n, setN] = useState(0);
  useMount(() => {{
    const tick = () => {{ setN(Date.now()); requestAnimationFrame(tick); }};
    tick();
    const items = () => {{ setN(1); setTimeout(items, 100); }};
    items();
  }});
  return <b>{{n}}</b>;
}}"
        ))
        .unwrap();
        assert!(out.contains("requestAnimationFrame(tick);"), "{out}");
        assert!(out.contains("setTimeout(items, 100);"), "{out}");
        assert!(!out.contains("context.items"), "{out}");
    }

    #[test]
    fn every_block_has_its_own_scope() {
        let out = store(&format!(
            "{IMPORTS}
export function A({{ items }}: {{ items: number[] }}) {{
  const [n, setN] = useState(0);
  useMount(() => {{
    switch (n) {{ case 1: {{ const items = [9]; console.log(items); break; }} default: setN(items.length); }}
    {{ const items = [1]; console.log(items); }}
    if (n) {{ const items = [2]; console.log(items); }} else {{ const items = [3]; console.log(items); }}
    try {{ const items = [4]; console.log(items); }} catch (items) {{ console.log(items); }} finally {{ const items = 5; console.log(items); }}
    console.log(items);
  }});
  return <b>{{n}}</b>;
}}"
        ))
        .unwrap();
        assert!(
            out.contains("default:\n          (context.n = context.items.length);"),
            "{out}"
        );
        assert!(
            out.contains("const items = [9];\n            console.log(items);"),
            "{out}"
        );
        assert!(out.contains("catch (items) {\n        console.log(items);"), "{out}");
        assert!(out.contains("      console.log(context.items);\n    },"), "{out}");
    }

    #[test]
    fn callback_parameters_take_defaults_rest_and_destructuring() {
        let out = store(&format!(
            "{IMPORTS}
export function A({{ step }}: {{ step: number }}) {{
  const [n, setN] = useState(0);
  const add = (by = step, ...more: number[]) => setN(n + by + more.length);
  const pick = ({{ detail: {{ x }} }}: CustomEvent, [first] = [step]) => setN(x + first);
  useMount(async () => {{
    window.addEventListener(\"pick\", ({{ detail }}: any, ...rest: any[]) => setN(detail + rest.length));
    [[1, 2]].forEach(([a, b = step]) => setN(a + b));
    const run = async (url = \"/x\") => {{
      for await (const chunk of (await fetch(url)).body) {{ setN(chunk.length); }}
    }};
    await run();
  }});
  return <b onClick={{() => add()}} onKeyDown={{(e) => pick(e)}}>{{n}}</b>;
}}"
        ))
        .unwrap();
        for expected in [
            "add(...__spArgs) {\n      const context = getContext();\n      return ((by = context.step, ...more) => {",
            "pick(...__spArgs) {\n      const context = getContext();\n      return (({ \"detail\": { \"x\": x } }, [first] = [context.step]) => {",
            "(({ \"detail\": detail }, ...rest) => (context.n = (detail + rest.length)))",
            "(([a, b = context.step]) => (context.n = (a + b)))",
            "(async (url = \"/x\") => {",
            "for await (const chunk of (await fetch(url)).body) {",
        ] {
            assert!(out.contains(expected), "{expected:?} in:\n{out}");
        }
    }

    #[test]
    fn refusals_that_still_hold() {
        for (body, refusal) in [
            // A prop is read-only, in place or whole.
            (
                "useMount(() => { label.length = 0; });",
                "changing a field of `label` in place",
            ),
            ("useMount(() => { label = \"x\"; });", "`label` can't be assigned here"),
            // A global is never reassigned itself.
            ("useMount(() => { window = null; });", "`window` can't be assigned here"),
            // `await` in a callback that isn't async (the parser refuses it first).
            (
                "useMount(async () => { [1].forEach((x) => { await fetch(\"/\"); }); });",
                "`await` is only allowed within async functions",
            ),
            (
                "useMount(() => { await fetch(\"/\"); });",
                "`await` is only allowed within async functions",
            ),
            ("useMount(() => { for await (const x of []) {} });", "`for await`"),
            // `for await` in the handler itself (a generator the runtime steps) isn't supported.
            ("useMount(async () => { for await (const x of []) {} });", "`for await`"),
            // `var` is function-scoped: refused rather than compiled as `let`.
            (
                "useMount(() => { for (var i = 0; i < 2; i++) setTimeout(() => setN(i)); });",
                "`var` isn't supported in client code",
            ),
            ("useMount(() => { var x = 1; setN(x); });", "`var` isn't supported"),
            ("useMount(() => { for (var k in {}) {} });", "`var` isn't supported"),
            ("useMount(() => { for (var v of []) {} });", "`var` isn't supported"),
            (
                "useMount(() => { setN(secret); });",
                "`secret` isn't available in the browser",
            ),
        ] {
            let err = store(&format!(
                "{IMPORTS}
export function A({{ label }}: {{ label: string }}) {{ const [n, setN] = useState(0); {body} return <b>{{n}}</b>; }}"
            ))
            .unwrap_err();
            assert!(err.contains(refusal), "{body}: expected {refusal:?}, got {err:?}");
        }
    }
}
