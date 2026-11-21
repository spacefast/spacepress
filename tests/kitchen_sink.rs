//! examples/kitchen-sink uses every authoring feature, and runs.
//!
//! `kitchen_sink_exercises_public_api` reads the declarations in types/typedpress with the oxc
//! parser and requires the example to use each one: every value a module exports, every method of
//! an exported object or interface (`mail.render`, `db.delete`, `wp.posts.clone`, the kind API,
//! the collection hooks, the column modifiers), every `defineConfig` key, every page export and
//! each kind of asset import. A use is a call, a JSX tag or, for a hook, a declared handler, found
//! in the example's syntax tree: a name in a comment, a string or `void x` does not count.
//! Whatever cannot be used in one app is in an allowlist below, each entry with its reason. A new
//! export, method or config key therefore fails this test until the example uses it or an entry
//! says why it does not. It needs no build and runs in the `quick` CI job.
//!
//! `kitchen_sink_renders_every_route_on_wordpress` builds the example and drives it on WordPress
//! (tests/php/kitchen_sink.php).
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::Command;

use oxc_allocator::Allocator;
use oxc_ast::AstKind;
use oxc_ast::ast::{
    BindingPattern, Declaration, ExportDefaultDeclarationKind, Expression, ImportDeclarationSpecifier, JSXElementName,
    ObjectPropertyKind, PropertyKey, Statement, TSSignature, TSType,
};
use oxc_parser::Parser;
use oxc_semantic::{AstNodes, SemanticBuilder};
use oxc_span::SourceType;

const ROOT: &str = env!("CARGO_MANIFEST_DIR");

/// The modules an app imports from, with the file that declares each.
const MODULES: &[(&str, &str)] = &[
    ("typedpress", "index.d.ts"),
    ("typedpress/app", "app.d.ts"),
    ("typedpress/client", "client.d.ts"),
    ("typedpress/content", "content.d.ts"),
    ("php/wordpress", "wordpress.d.ts"),
];

/// Interfaces whose methods an app calls on a value it gets from a module: (module, interface,
/// label in a failure, the ways the example reaches a value of it).
const INTERFACES: &[(&str, &str, &str, &[Reach])] = &[
    ("typedpress", "ColumnBuilder", "ColumnBuilder", &[Reach::Builder]),
    ("typedpress", "Database", "db", &[Reach::Member("typedpress", "db")]),
    (
        "typedpress",
        "InsertBuilder",
        "db.insert()",
        &[Reach::Chain("typedpress", "db")],
    ),
    (
        "typedpress",
        "UpdateBuilder",
        "db.update()",
        &[Reach::Chain("typedpress", "db")],
    ),
    (
        "typedpress",
        "UpdateSetQuery",
        "db.update().set()",
        &[Reach::Chain("typedpress", "db")],
    ),
    (
        "typedpress",
        "DeleteQuery",
        "db.delete()",
        &[Reach::Chain("typedpress", "db")],
    ),
    (
        "typedpress",
        "WriteQuery",
        "a db write",
        &[Reach::Chain("typedpress", "db")],
    ),
    (
        "typedpress",
        "CollectionQuery",
        "db.query.<kind>",
        &[Reach::MemberOf("typedpress", "db", "query")],
    ),
    (
        "typedpress",
        "GlobalApi",
        "db.globals.<global>",
        &[Reach::MemberOf("typedpress", "db", "globals")],
    ),
    (
        "typedpress",
        "KindApi",
        "<kind> from typedpress:db",
        &[Reach::Import("typedpress:db"), Reach::SystemOf("typedpress:db")],
    ),
    ("typedpress", "Job", "<job>", &[Reach::Chain("typedpress", "job")]),
    ("typedpress", "CollectionHooks", "collection hook", &[Reach::HookKey]),
    ("typedpress", "ConfigInput", "defineConfig", &[Reach::ConfigKey]),
];

/// How the example reaches a value whose members are required.
#[derive(Clone, Copy)]
enum Reach {
    /// `text().min(1).method(...)`: a call chain that starts at a field builder of "typedpress"
    /// (a function the declarations say returns a `ColumnBuilder`).
    Builder,
    /// `<name>.a(...).method(...)`: a call chain that starts at this import.
    Chain(&'static str, &'static str),
    /// `<name>.method(...)`, `name` imported from the module.
    Member(&'static str, &'static str),
    /// `<name>.<prop>.<anything>.method(...)`.
    MemberOf(&'static str, &'static str, &'static str),
    /// `<any named import of the module>.method(...)`.
    Import(&'static str),
    /// `<any named import of the module>.system.method(...)`.
    SystemOf(&'static str),
    /// A key of an object passed to `.on({...})` or under `definePlugin({ hooks })`.
    HookKey,
    /// A key of the object passed to `defineConfig({...})`.
    ConfigKey,
}

/// Features the example leaves out, each with the reason. Keys are the labels a failure prints.
const NOT_USED: &[(&str, &str)] = &[
    // Locales are turned off in normal builds (docs/decisions/2026-11-17-locales-off.md): setting
    // either fails `typedpress build` unless TYPEDPRESS_LOCALES is set, which examples never do.
    ("ColumnBuilder.localized", "locales are off in normal builds"),
    ("defineConfig.locales", "locales are off in normal builds"),
    // The example has guarded pages, forms and request-time reads; `output: "static"` prebuilds
    // every page and refuses those. Its prerendered page (visits/[day]) covers prebuilding.
    (
        "defineConfig.output",
        "a static export cannot hold guarded or request-time pages",
    ),
    // The example renders its own pages; `frontend` hands rendering to another site or turns it off.
    ("defineConfig.frontend", "the app renders its own pages"),
    // The schedule screen lives in TypedPress Admin, which `admin: false` leaves out of the build.
    (
        "defineConfig.admin",
        "the example's admin screen needs TypedPress Admin",
    ),
    // Sealed mode refuses every plugin the config does not pin, which would stop a reader from
    // trying the example beside their own plugins. docs/sealed.md and tests/wp cover it.
    ("defineConfig.sealed", "an example site should accept other plugins"),
    // Runtime schema changes are made on the running site and committed back by `typedpress pull`;
    // an example that ships none would only switch the option on. tests/runtime_schema.rs covers it.
    (
        "defineConfig.runtimeSchema",
        "the example commits no site-made schema changes",
    ),
    // GET and POST handlers already go through the HTTP handler compiler.
    ("page export PUT", "GET and POST exercise the handler compiler"),
    ("page export PATCH", "GET and POST exercise the handler compiler"),
    ("page export DELETE", "GET and POST exercise the handler compiler"),
];

fn files(dir: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        if matches!(entry.file_name().to_str(), Some("dist" | ".tp" | "node_modules")) {
            continue;
        }
        if entry.file_type().unwrap().is_dir() {
            paths.extend(files(&entry.path()));
        } else {
            paths.push(entry.path());
        }
    }
    paths.sort();
    paths
}

fn key_name(key: &PropertyKey) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(id) => Some(id.name.to_string()),
        PropertyKey::StringLiteral(s) => s.value.as_str().map(str::to_string),
        _ => None,
    }
}

/// What a declaration file offers: the values it exports, the members of each exported object,
/// and the methods and properties of each interface.
#[derive(Default)]
struct Declared {
    values: BTreeSet<String>,
    /// `export declare const mail: { send(...); render(...) }` → `mail` → {send, render}; a nested
    /// object (`wp.posts`) is `wp.posts` → {extend, clone}.
    objects: BTreeMap<String, BTreeSet<String>>,
    interfaces: BTreeMap<String, BTreeSet<String>>,
    /// Exported functions whose declared result is a `ColumnBuilder`: `text`, `ref`, `select`, ...
    builders: BTreeSet<String>,
}

fn members(signatures: &[TSSignature]) -> BTreeSet<String> {
    signatures
        .iter()
        .filter_map(|signature| match signature {
            TSSignature::TSMethodSignature(method) => key_name(&method.key),
            TSSignature::TSPropertySignature(property) => key_name(&property.key),
            _ => None,
        })
        .collect()
}

fn object_members(name: &str, ty: &TSType, out: &mut BTreeMap<String, BTreeSet<String>>) {
    let TSType::TSTypeLiteral(literal) = ty else { return };
    let mut own = BTreeSet::new();
    for signature in &literal.members {
        match signature {
            TSSignature::TSMethodSignature(method) => own.extend(key_name(&method.key)),
            TSSignature::TSPropertySignature(property) => {
                let Some(key) = key_name(&property.key) else { continue };
                match property.type_annotation.as_deref().map(|a| &a.type_annotation) {
                    // A nested object of methods is reached through its key, never called itself.
                    Some(nested @ TSType::TSTypeLiteral(_)) => object_members(&format!("{name}.{key}"), nested, out),
                    _ => {
                        own.insert(key);
                    }
                }
            }
            _ => {}
        }
    }
    if !own.is_empty() {
        out.insert(name.to_string(), own);
    }
}

fn declared(path: &Path) -> Declared {
    let source = std::fs::read_to_string(path).unwrap();
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &source, SourceType::d_ts()).parse();
    assert!(
        parsed.diagnostics.is_empty(),
        "{}: {:?}",
        path.display(),
        parsed.diagnostics
    );
    let mut out = Declared::default();
    for statement in &parsed.program.body {
        let declaration = match statement {
            Statement::ExportDeclaration(export) => Some(&export.declaration),
            _ => None,
        };
        // An interface that is not exported still shapes exported values (`KindApi` is, some are not).
        let declaration = match (declaration, statement) {
            (Some(declaration), _) => declaration,
            (None, Statement::TSInterfaceDeclaration(interface)) => {
                out.interfaces
                    .entry(interface.id.name.to_string())
                    .or_default()
                    .extend(members(&interface.body.body));
                continue;
            }
            _ => continue,
        };
        match declaration {
            Declaration::FunctionDeclaration(function) => {
                let Some(id) = &function.id else { continue };
                out.values.insert(id.name.to_string());
                if let Some(TSType::TSTypeReference(result)) =
                    function.return_type.as_deref().map(|r| &r.type_annotation)
                    && result.type_name.to_string() == "ColumnBuilder"
                {
                    out.builders.insert(id.name.to_string());
                }
            }
            Declaration::ClassDeclaration(class) => {
                out.values.extend(class.id.as_ref().map(|id| id.name.to_string()));
            }
            Declaration::VariableDeclaration(variables) => {
                for declarator in &variables.declarations {
                    let BindingPattern::BindingIdentifier(id) = &declarator.id else {
                        continue;
                    };
                    out.values.insert(id.name.to_string());
                    if let Some(annotation) = &declarator.type_annotation {
                        object_members(id.name.as_str(), &annotation.type_annotation, &mut out.objects);
                    }
                }
            }
            Declaration::TSEnumDeclaration(declaration) if !declaration.r#const => {
                out.values.insert(declaration.id.name.to_string());
            }
            // `export declare namespace x { ... }` is a value an app can reach into.
            Declaration::TSNamespaceDeclaration(namespace) => {
                out.values.insert(namespace.id.name.to_string());
            }
            Declaration::TSInterfaceDeclaration(interface) => {
                out.interfaces
                    .entry(interface.id.name.to_string())
                    .or_default()
                    .extend(members(&interface.body.body));
            }
            _ => {}
        }
    }
    out
}

/// What the example's code uses, found in its syntax trees.
#[derive(Default)]
struct Used {
    /// (module, export): called, constructed or rendered as a JSX tag.
    called: BTreeSet<(String, String)>,
    /// (module, export, path): `mail.render(...)` is ("typedpress", "mail", ["render"]).
    member_calls: BTreeSet<(String, String, Vec<String>)>,
    /// (module, export, method): `text().min(1).max(9)` is ("typedpress", "text", "min") and
    /// (.., "max"); `db.insert(t).values(v).returning()` is ("typedpress", "db", "values") and
    /// (.., "returning"). The chain's first call is in `called` or `member_calls`.
    chain_calls: BTreeSet<(String, String, String)>,
    /// Keys of objects passed to `.on({...})` and of each kind under `definePlugin({ hooks })`.
    hooks: BTreeSet<String>,
    /// Keys of the object passed to `defineConfig`.
    config: BTreeSet<String>,
    /// `export const x` / `export function x` / `export default` in files under tp/app/.
    page_exports: BTreeSet<String>,
    /// Extensions of imported assets whose import is used: "module.css" and "svg" need a use, "css" is a side effect.
    assets: BTreeSet<&'static str>,
}

fn unwrap<'a, 'b>(mut expression: &'b Expression<'a>) -> &'b Expression<'a> {
    loop {
        expression = match expression {
            Expression::ParenthesizedExpression(e) => &e.expression,
            Expression::TSNonNullExpression(e) => &e.expression,
            Expression::TSAsExpression(e) => &e.expression,
            Expression::TSSatisfiesExpression(e) => &e.expression,
            _ => return expression,
        };
    }
}

/// `a.b.c` as its root identifier and the property path, when it is that plain.
fn member_path<'a, 'b>(
    expression: &'b Expression<'a>,
) -> Option<(&'b oxc_ast::ast::IdentifierReference<'a>, Vec<String>)> {
    let mut path = Vec::new();
    let mut current = unwrap(expression);
    loop {
        match current {
            Expression::StaticMemberExpression(member) => {
                path.push(member.property.name.to_string());
                current = unwrap(&member.object);
            }
            Expression::Identifier(id) => {
                path.reverse();
                return Some((id, path));
            }
            _ => return None,
        }
    }
}

/// The identifier a chain of calls and property reads starts at: `text` in `text().min(1).max(9)`,
/// `db` in `db.insert(t).values(v)`. None when the chain starts at anything else.
fn chain_root<'a, 'b>(expression: &'b Expression<'a>) -> Option<&'b oxc_ast::ast::IdentifierReference<'a>> {
    let mut current = unwrap(expression);
    loop {
        current = match current {
            Expression::StaticMemberExpression(member) => unwrap(&member.object),
            Expression::CallExpression(call) => unwrap(&call.callee),
            Expression::Identifier(id) => return Some(id),
            _ => return None,
        };
    }
}

fn object_keys(expression: &Expression) -> Vec<String> {
    match unwrap(expression) {
        Expression::ObjectExpression(object) => object
            .properties
            .iter()
            .filter_map(|property| match property {
                ObjectPropertyKind::ObjectProperty(property) => key_name(&property.key),
                ObjectPropertyKind::SpreadProperty(_) => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn property<'a, 'b>(expression: &'b Expression<'a>, name: &str) -> Option<&'b Expression<'a>> {
    let Expression::ObjectExpression(object) = unwrap(expression) else {
        return None;
    };
    object.properties.iter().find_map(|property| match property {
        ObjectPropertyKind::ObjectProperty(property) if key_name(&property.key).as_deref() == Some(name) => {
            Some(&property.value)
        }
        _ => None,
    })
}

/// Whether a reference to an imported name is a use: the callee of a call or `new`, the object a
/// called method is reached through, an argument or a value handed on (`action: closeRegistration`,
/// `ref(events)`), or a JSX tag or attribute value. An expression statement (`void x`, `x;`) and a
/// `typeof` are not.
fn is_use(nodes: &AstNodes, mut node: oxc_semantic::NodeId) -> bool {
    loop {
        let parent = nodes.parent_id(node);
        if parent == node {
            return false;
        }
        match nodes.kind(parent) {
            AstKind::ExpressionStatement(_) | AstKind::UnaryExpression(_) | AstKind::TSTypeQuery(_) => return false,
            AstKind::ParenthesizedExpression(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::ChainExpression(_) => node = parent,
            // `x.y` on its own reads a property; it is a use once something is done with the result.
            AstKind::StaticMemberExpression(_) | AstKind::ComputedMemberExpression(_) => node = parent,
            _ => return true,
        }
    }
}

fn scan(path: &Path, app: &Path, used: &mut Used) {
    let source = std::fs::read_to_string(path).unwrap();
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &source, SourceType::from_path(path).unwrap()).parse();
    assert!(
        parsed.diagnostics.is_empty(),
        "{}: {:?}",
        path.display(),
        parsed.diagnostics
    );
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .build(&parsed.program)
        .semantic;
    let nodes = semantic.nodes();
    let scoping = semantic.scoping();
    let in_app = path.starts_with(app.join("tp/app"));

    // Imported names by symbol: (module, exported name). A default import is "default".
    let mut imported = BTreeMap::new();
    // Locals bound directly to a call of an imported builder (e.g. `const x = job(...)`).
    let mut bound_from = BTreeMap::new();
    for statement in &parsed.program.body {
        match statement {
            Statement::ImportDeclaration(import) => {
                let module = import.source.value.as_str().unwrap();
                for specifier in import.specifiers.iter().flatten() {
                    let (local, name) = match specifier {
                        ImportDeclarationSpecifier::ImportSpecifier(s) => (&s.local, s.imported.name().to_string()),
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => (&s.local, "default".to_string()),
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(s) => (&s.local, "*".to_string()),
                    };
                    let symbol = local.symbol_id.get().unwrap();
                    let live = scoping
                        .get_resolved_references(symbol)
                        .any(|reference| reference.flags().is_value() && is_use(nodes, reference.node_id()));
                    if live {
                        if module.ends_with(".module.css") {
                            used.assets.insert("module.css");
                        } else if module.ends_with(".svg") {
                            used.assets.insert("svg");
                        }
                    }
                    imported.insert(symbol, (module.to_string(), name));
                }
                if import
                    .specifiers
                    .as_ref()
                    .is_none_or(|specifiers| specifiers.is_empty())
                    && module.ends_with(".css")
                    && !module.ends_with(".module.css")
                {
                    used.assets.insert("css");
                }
            }
            Statement::ExportDeclaration(export) if in_app => match &export.declaration {
                Declaration::VariableDeclaration(variables) => {
                    for declarator in &variables.declarations {
                        if let BindingPattern::BindingIdentifier(id) = &declarator.id {
                            used.page_exports.insert(id.name.to_string());
                        }
                    }
                }
                Declaration::FunctionDeclaration(function) => {
                    used.page_exports
                        .extend(function.id.as_ref().map(|id| id.name.to_string()));
                }
                _ => {}
            },
            Statement::ExportDefaultDeclaration(export)
                if in_app
                    && !matches!(
                        export.declaration,
                        ExportDefaultDeclarationKind::TSInterfaceDeclaration(_)
                    ) =>
            {
                used.page_exports.insert("default".to_string());
            }
            _ => {}
        }
    }
    let resolve = |id: &oxc_ast::ast::IdentifierReference| -> Option<&(String, String)> {
        let symbol = scoping.get_reference(id.reference_id()).symbol_id()?;
        imported.get(&symbol)
    };

    for node in nodes.iter() {
        if let AstKind::VariableDeclarator(decl) = node.kind()
            && let BindingPattern::BindingIdentifier(id) = &decl.id
            && let Some(init) = &decl.init
            && matches!(unwrap(init), Expression::CallExpression(_))
            && let Some((module, name)) = chain_root(init).and_then(&resolve)
        {
            bound_from.insert(id.symbol_id.get().unwrap(), (module.clone(), name.clone()));
        }
    }
    for node in nodes.iter() {
        match node.kind() {
            AstKind::CallExpression(call) => {
                let callee = unwrap(&call.callee);
                if let Expression::StaticMemberExpression(member) = callee {
                    // A method called on the result of a call: a link of a chain.
                    if matches!(unwrap(&member.object), Expression::CallExpression(_))
                        && let Some((module, name)) = chain_root(&member.object).and_then(&resolve)
                    {
                        used.chain_calls
                            .insert((module.clone(), name.clone(), member.property.name.to_string()));
                    }
                    // A method called on a local bound to a builder call (e.g. `recordEvent.enqueue(...)`).
                    if let Expression::Identifier(id) = unwrap(&member.object)
                        && let Some(sym) = scoping.get_reference(id.reference_id()).symbol_id()
                        && let Some((module, name)) = bound_from.get(&sym)
                    {
                        used.chain_calls
                            .insert((module.clone(), name.clone(), member.property.name.to_string()));
                    }
                    // `events.on({ beforeCreate ... })`, and the same chained from `collection(...)`.
                    if member.property.name == "on"
                        && let Some(argument) = call.arguments.first().and_then(|a| a.as_expression())
                    {
                        used.hooks.extend(object_keys(argument));
                    }
                }
                if let Some((root, path)) = member_path(callee)
                    && let Some((module, name)) = resolve(root)
                {
                    if path.is_empty() {
                        used.called.insert((module.clone(), name.clone()));
                        let argument = call.arguments.first().and_then(|a| a.as_expression());
                        if module == "typedpress" && name == "defineConfig" {
                            used.config.extend(argument.map(object_keys).unwrap_or_default());
                        }
                        // `definePlugin({ hooks: { recipes: { beforeCreate } } })`.
                        if module == "typedpress"
                            && name == "definePlugin"
                            && let Some(hooks) = argument.and_then(|a| property(a, "hooks"))
                            && let Expression::ObjectExpression(kinds) = unwrap(hooks)
                        {
                            for kind in &kinds.properties {
                                if let ObjectPropertyKind::ObjectProperty(kind) = kind {
                                    used.hooks.extend(object_keys(&kind.value));
                                }
                            }
                        }
                    } else {
                        used.member_calls.insert((module.clone(), name.clone(), path));
                    }
                }
            }
            AstKind::NewExpression(new) => {
                if let Expression::Identifier(id) = unwrap(&new.callee)
                    && let Some((module, name)) = resolve(id)
                {
                    used.called.insert((module.clone(), name.clone()));
                }
            }
            AstKind::JSXOpeningElement(element) => {
                if let JSXElementName::IdentifierReference(id) = &element.name
                    && let Some((module, name)) = resolve(id)
                {
                    used.called.insert((module.clone(), name.clone()));
                }
            }
            _ => {}
        }
    }
}

/// Everything the declarations offer that the app does not use, allowlisted or not.
fn unused(types: &Path, app: &Path) -> BTreeSet<String> {
    let mut used = Used::default();
    let all = files(app);
    for path in &all {
        if path.components().any(|part| part.as_os_str() == "_generated")
            || !matches!(path.extension().and_then(|e| e.to_str()), Some("ts" | "tsx"))
            || path.to_str().is_some_and(|p| p.ends_with(".d.ts"))
        {
            continue;
        }
        scan(path, app, &mut used);
    }

    let declarations: BTreeMap<&str, Declared> = MODULES
        .iter()
        .map(|(module, file)| (*module, declared(&types.join(file))))
        .collect();
    let mut missing = BTreeSet::new();

    // Every exported value is called, constructed or rendered; an exported object's members are.
    for (module, declaration) in &declarations {
        for name in &declaration.values {
            let reached = used.called.contains(&(module.to_string(), name.clone()))
                || used.member_calls.iter().any(|(m, n, _)| m == module && n == name);
            if !reached {
                missing.insert(format!("{module}::{name}"));
            }
        }
        for (object, methods) in &declaration.objects {
            let mut path: Vec<String> = object.split('.').map(str::to_string).collect();
            let root = path.remove(0);
            for method in methods {
                let mut full = path.clone();
                full.push(method.clone());
                if !used.member_calls.contains(&(module.to_string(), root.clone(), full)) {
                    missing.insert(format!("{object}.{method}"));
                }
            }
        }
    }
    // The compiler's own list of what "typedpress/app" exports, so the declarations cannot fall behind it.
    for name in typedpress::app::EXPORTS {
        if !used.called.contains(&("typedpress/app".to_string(), name.to_string())) {
            missing.insert(format!("typedpress/app::{name}"));
        }
    }

    for (module, interface, label, reaches) in INTERFACES {
        let methods = declarations[module]
            .interfaces
            .get(*interface)
            .unwrap_or_else(|| panic!("{module} declares no interface {interface}"));
        for method in methods {
            let reached = reaches.iter().any(|reach| match reach {
                Reach::Builder => used.chain_calls.iter().any(|(m, root, called)| {
                    m == module && called == method && declarations[module].builders.contains(root)
                }),
                Reach::Chain(module, name) => used
                    .chain_calls
                    .iter()
                    .any(|(m, root, called)| m == module && root == name && called == method),
                Reach::Member(module, name) => used
                    .member_calls
                    .iter()
                    .any(|(m, n, path)| m == module && n == name && path.as_slice() == [method.clone()]),
                Reach::MemberOf(module, name, prop) => used.member_calls.iter().any(|(m, n, path)| {
                    m == module && n == name && path.len() == 3 && path[0] == *prop && path[2] == *method
                }),
                Reach::Import(module) => used
                    .member_calls
                    .iter()
                    .any(|(m, _, path)| m == module && path.first() == Some(method)),
                Reach::SystemOf(module) => used
                    .member_calls
                    .iter()
                    .any(|(m, _, path)| m == module && path.len() == 2 && path[0] == "system" && path[1] == *method),
                Reach::HookKey => used.hooks.contains(method),
                Reach::ConfigKey => used.config.contains(method),
            });
            // A property of an interface that only holds other objects (`db.query`, `db.globals`)
            // is reached through its members, which their own interfaces require.
            let container = *interface == "Database" && matches!(method.as_str(), "query" | "globals");
            if !reached && !container {
                missing.insert(format!("{label}.{method}"));
            }
        }
    }

    // `<kind>.system`: the kind API without the visitor's rules. It is a property of each kind, not
    // an interface of its own, so it is required by name.
    if !used
        .member_calls
        .iter()
        .any(|(module, _, path)| module == "typedpress:db" && path.len() == 2 && path[0] == "system")
    {
        missing.insert("<kind>.system from typedpress:db".to_string());
    }

    // The files a tp/app/ tree may hold, and every export a page or route may have.
    for file in ["layout.tsx", "login.tsx", "not-found.tsx", "error.tsx"] {
        if !app.join("tp/app").join(file).is_file() {
            missing.insert(format!("tp/app/{file}"));
        }
    }
    let app_root = app.join("tp/app");
    for file in ["page.tsx", "page.md", "route.ts"] {
        if !all
            .iter()
            .any(|p| p.starts_with(&app_root) && p.file_name().is_some_and(|name| name == file))
        {
            missing.insert(format!("tp/app/**/{file}"));
        }
    }
    for export in typedpress::app::allowed_exports("page.tsx") {
        if !used.page_exports.contains(*export) {
            missing.insert(format!("page export {export}"));
        }
    }

    // What an app may hold beside its code.
    for (asset, what) in [
        ("css", "a stylesheet import (`import \"./site.css\"`)"),
        ("module.css", "a CSS module import whose classes are used"),
        ("svg", "an SVG import whose URL is used"),
    ] {
        if !used.assets.contains(asset) {
            missing.insert(what.to_string());
        }
    }
    for (path, what) in [
        ("emails", "an emails/ template (mail.render)"),
        ("tp/wp-hooks", "a tp/wp-hooks/ handler"),
        ("tp/plugins", "a plugin package under tp/plugins/"),
        ("content", "synced content/ files"),
    ] {
        let dir = app.join(path);
        if !all
            .iter()
            .any(|p| p.starts_with(&dir) && !p.to_str().is_some_and(|p| p.ends_with(".d.ts")))
        {
            missing.insert(what.to_string());
        }
    }

    missing
}

#[test]
fn kitchen_sink_exercises_public_api() {
    let root = Path::new(ROOT);
    let unused = unused(&root.join("types/typedpress"), &root.join("examples/kitchen-sink"));
    let allowed: BTreeSet<&str> = NOT_USED.iter().map(|(name, _)| *name).collect();
    // An allowlist entry for something the example does use, or that no longer exists, is stale.
    let stale: Vec<&str> = allowed.iter().copied().filter(|name| !unused.contains(*name)).collect();
    assert!(
        stale.is_empty(),
        "NOT_USED in tests/kitchen_sink.rs lists what the kitchen sink uses, or what no longer exists: {}",
        stale.join(", ")
    );
    let missing: Vec<String> = unused
        .into_iter()
        .filter(|name| !allowed.contains(name.as_str()))
        .collect();
    assert!(
        missing.is_empty(),
        "examples/kitchen-sink does not use: {}\nUse each in the example, or add it to NOT_USED in tests/kitchen_sink.rs with the reason.",
        missing.join(", ")
    );
}

/// The check itself: a name that appears only in a comment, a string, `void x` or an unused
/// import is not a use, and an `export declare namespace` is a value the example must use.
#[test]
fn coverage_check_requires_a_real_use() {
    let dir = tempfile::tempdir().unwrap();
    let types = dir.path().join("types");
    let app = dir.path().join("app");
    std::fs::create_dir_all(app.join("tp/app")).unwrap();
    std::fs::create_dir_all(&types).unwrap();
    let real = Path::new(ROOT).join("types/typedpress");
    for (_, file) in MODULES {
        std::fs::copy(real.join(file), types.join(file)).unwrap();
    }
    // A namespace export the regex this replaced did not see.
    let mut app_types = std::fs::read_to_string(types.join("app.d.ts")).unwrap();
    app_types.push_str("\nexport declare namespace Probe { function run(): void }\n");
    std::fs::write(types.join("app.d.ts"), app_types).unwrap();
    std::fs::write(
        app.join("tp/app/page.tsx"),
        r#"import { Html, Link, notFound } from "typedpress/app";
import { db, mail, text } from "typedpress";
import styles from "./page.module.css";
// mail.render(Template, props) and text().unique() in a comment are not uses.
const note = "db.delete(rows) and .validate() in a string are not uses either";
export default function Page() {
  void Html;
  void styles;
  void db.delete;
  notFound;
  const shortest = [note].map((entry) => entry.length).reduce((a, b) => Math.min(a, b));
  return <Link href="/">{note}{text().optional() ? shortest : ""}{mail.send.name}</Link>;
}
"#,
    )
    .unwrap();
    let missing = unused(&types, &app);
    for name in [
        "typedpress/app::Html",
        "typedpress/app::notFound",
        "typedpress/app::Probe",
        "mail.render",
        "mail.send",
        "db.delete",
        "ColumnBuilder.unique",
        "ColumnBuilder.validate",
        // `Math.min(a, b)` is no column modifier.
        "ColumnBuilder.min",
        "db.insert().values",
        "<kind>.system from typedpress:db",
        "a CSS module import whose classes are used",
    ] {
        assert!(missing.contains(name), "{name} should be reported: {missing:?}");
    }
    for name in [
        "typedpress/app::Link",
        "typedpress::text",
        "ColumnBuilder.optional",
        "page export default",
    ] {
        assert!(!missing.contains(name), "{name} is used: {missing:?}");
    }
}

#[test]
fn kitchen_sink_renders_every_route_on_wordpress() {
    let root = Path::new(ROOT);
    let example = root.join("examples/kitchen-sink");
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("kitchen-sink");
    for path in files(&example) {
        let target = project.join(path.strip_prefix(&example).unwrap());
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::copy(path, target).unwrap();
    }
    let out = temp.path().join("wp-content");
    let build = Command::new(env!("CARGO_BIN_EXE_typedpress"))
        .arg("build")
        .arg(&project)
        .arg("--out")
        .arg(&out)
        .env_remove("TYPEDPRESS_LOCALES")
        .output()
        .unwrap();
    assert!(build.status.success(), "{}", String::from_utf8_lossy(&build.stderr));

    let runtime = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root.join("tests/php/kitchen_sink.php"))
        .arg(&out)
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    println!("{}", String::from_utf8_lossy(&runtime.stdout));
    assert!(runtime.status.success(), "{}", String::from_utf8_lossy(&runtime.stderr));
}
