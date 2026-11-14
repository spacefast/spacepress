//! Astro's `src/content.config.ts` read as First kinds (docs/decisions/2026-11-14-astro-content-config.md).
//!
//! A First project may keep the content collections of an Astro site it grew from:
//!
//! ```ts
//! // src/content.config.ts
//! import { defineCollection, z } from "astro:content";
//! import { glob } from "astro/loaders";
//!
//! const blog = defineCollection({
//!   loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
//!   schema: z.object({ title: z.string(), pubDate: z.coerce.date(), tags: z.array(z.string()).optional() }),
//! });
//! export const collections = { blog };
//! ```
//!
//! Each collection becomes a `collection()` whose files sync from the glob's folder, exactly as if
//! `first/` declared it: `export const blog = collection({ ...fields }, { sync: "src/content/blog/**/*.md" })`.
//! The file is read, never run: Astro's modules are not First's to evaluate, so only the plain forms
//! Astro's documentation writes are understood, and anything else is a build error at its place.
//!
//! The module this writes is TypeScript in First's own forms, loaded like any module under `first/`:
//! the kinds are then checked, compiled and synced by the code that handles every kind.

use crate::diag::{self, Code, Diag, Result, Span};
use oxc_allocator::Allocator;
use oxc_ast::ast as a;
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

/// Where Astro keeps its collections, relative to the project root.
pub const CONFIG: &str = "src/content.config.ts";
/// The module the collections are written into, as if it were under `first/` (it never is on disk).
pub const MODULE: &str = "first/_astro_content.ts";

/// One field of a collection, as the TypeScript expression of its First builder.
struct Field {
    name: String,
    builder: String,
}

struct Collection {
    name: String,
    /// The sync pattern: `<base>/**/*.md`, a folder tree, so a file's path is its slug as in Astro.
    sync: String,
    fields: Vec<Field>,
    /// The field the title option points at.
    title: String,
}

/// The First module for `src/content.config.ts`, or `None` when the project has none.
pub fn module(fs: &dyn crate::loader::Fs, root: &Path) -> Result<Option<(PathBuf, String)>> {
    let path = root.join(CONFIG);
    if !fs.is_file(&path) {
        return Ok(None);
    }
    let source = fs
        .read_to_string(&path)
        .map_err(|e| Diag::new(Span::NONE, format!("can't read {CONFIG}: {e}")).code(Code::Import))?;
    let file = diag::register_file(&path, &source);
    let collections = read(&source, file)?;
    Ok(Some((root.join(MODULE), write(&collections))))
}

fn write(collections: &[Collection]) -> String {
    let mut out = String::from(
        "// Generated from src/content.config.ts: each Astro content collection as a First kind.\nimport { collection, text, slug, richText, number, integer, boolean, date, timestamp, url, email, json, select } from \"first\";\n",
    );
    for c in collections {
        let mut fields: Vec<String> = c
            .fields
            .iter()
            .map(|f| format!("{}: {}", key(&f.name), f.builder))
            .collect();
        fields.push("slug: slug()".into());
        fields.push("body: richText().optional()".into());
        let _ = writeln!(
            out,
            "export const {} = collection({{ {} }}, {{ title: {:?}, content: \"body\", hierarchical: true, sync: {:?}, access: {{ read: \"anyone\", create: \"editor\", update: \"editor\", delete: \"editor\" }} }});",
            c.name,
            fields.join(", "),
            c.title,
            c.sync
        );
    }
    out
}

fn key(name: &str) -> String {
    if name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
        && !name.starts_with(|c: char| c.is_ascii_digit())
    {
        name.to_string()
    } else {
        format!("{name:?}")
    }
}

/// Fields First adds to a synced, hierarchical kind with drafts, or that its files never hold.
const RESERVED: &[(&str, &str)] = &[
    ("id", "every kind has an integer `id`"),
    ("uid", "First's sync identifies each file by `uid`"),
    ("slug", "the file's name is its slug"),
    ("body", "the Markdown below the front matter is the body"),
    ("parent", "the file's folder is its parent"),
    ("order", "First adds `order` to a folder tree"),
    ("status", "First adds `status` for drafts"),
    ("publishedAt", "First adds `publishedAt` for drafts"),
];

struct Reader<'s> {
    source: &'s str,
    file: u32,
}

fn span(file: u32, s: oxc_span::Span) -> Span {
    Span {
        file,
        start: s.start,
        end: s.end,
    }
}

/// The callee name of `name(...)`, if the expression is a call of a plain identifier.
fn called<'b>(e: &'b a::Expression<'_>) -> Option<(&'b a::CallExpression<'b>, &'b str)>
where
    'b: 'b,
{
    match e.get_inner_expression() {
        a::Expression::CallExpression(c) => match c.callee.get_inner_expression() {
            a::Expression::Identifier(i) => Some((c, i.name.as_str())),
            _ => None,
        },
        _ => None,
    }
}

fn read(source: &str, file: u32) -> Result<Vec<Collection>> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
    if let Some(e) = parsed.diagnostics.errors().next() {
        let at = e
            .labels
            .first()
            .map(|l| Span {
                file,
                start: l.offset(),
                end: l.offset() + l.len(),
            })
            .unwrap_or(Span { file, start: 0, end: 0 });
        return Err(Diag::new(at, format!("syntax error: {}", e.message)).code(Code::Syntax));
    }
    // Every top-level `const x = ...`, exported or not. Nothing else in the file is read: imports,
    // helpers and statements the collections don't use are Astro's.
    let mut consts: Vec<(&str, &a::Expression<'_>)> = Vec::new();
    for stmt in &parsed.program.body {
        let declaration = match stmt {
            a::Statement::VariableDeclaration(v) => v.as_ref(),
            a::Statement::ExportDeclaration(e) => match &e.declaration {
                a::Declaration::VariableDeclaration(v) => v.as_ref(),
                _ => continue,
            },
            _ => continue,
        };
        for d in &declaration.declarations {
            if let (a::BindingPattern::BindingIdentifier(id), Some(init)) = (&d.id, &d.init) {
                consts.push((id.name.as_str(), init));
            }
        }
    }
    let Some((_, collections)) = consts.iter().find(|(n, _)| *n == "collections") else {
        return Err(Diag::new(
            Span { file, start: 0, end: 0 },
            "src/content.config.ts defines no `collections`",
        )
        .help("export them: `export const collections = { blog }`")
        .code(Code::Schema));
    };
    let a::Expression::ObjectExpression(object) = collections.get_inner_expression() else {
        return Err(unsupported(
            file,
            collections.span(),
            "this value of `collections`",
            "write `export const collections = { blog, docs }`",
        ));
    };
    let reader = Reader { source, file };
    let mut out = Vec::new();
    for prop in &object.properties {
        let a::ObjectPropertyKind::ObjectProperty(p) = prop else {
            return Err(unsupported(
                file,
                prop.span(),
                "a spread in `collections`",
                "list each collection by name",
            ));
        };
        let Some(name) = p.key.static_name().filter(|_| !p.computed) else {
            return Err(unsupported(
                file,
                p.span,
                "a computed collection name",
                "name it: `blog: defineCollection(...)`",
            ));
        };
        // `blog` (shorthand or a reference) names a `const blog = defineCollection(...)`.
        let value = match p.value.get_inner_expression() {
            a::Expression::Identifier(id) => match consts.iter().find(|(n, _)| *n == id.name.as_str()) {
                Some((_, e)) => *e,
                None => {
                    return Err(unsupported(
                        file,
                        id.span,
                        &format!("`{}`", id.name),
                        "define it in this file: `const blog = defineCollection({ ... })`",
                    ));
                }
            },
            other => other,
        };
        if let Some(c) = reader.define(&name, value)? {
            out.push(c);
        }
    }
    Ok(out)
}

fn unsupported(file: u32, s: oxc_span::Span, what: &str, help: &str) -> Diag {
    Diag::new(
        span(file, s),
        format!("{what} in src/content.config.ts can't be read as a First kind"),
    )
    .help(help)
    .code(Code::Schema)
}

impl<'s> Reader<'s> {
    fn at(&self, s: oxc_span::Span) -> Span {
        span(self.file, s)
    }

    /// The kind for one collection, or `None` for a collection whose files aren't First's (any
    /// loader other than `glob()`, such as `firstLoader()` reading a First site, stays Astro's).
    fn define(&self, name: &str, value: &a::Expression<'_>) -> Result<Option<Collection>> {
        let fail = |s: oxc_span::Span, what: &str, help: &str| {
            Diag::new(
                self.at(s),
                format!("{what} in src/content.config.ts can't be read as a First kind"),
            )
            .help(help)
            .code(Code::Schema)
        };
        let Some((call, "defineCollection")) = called(value) else {
            return Err(fail(
                value.span(),
                "this collection",
                "write it as `defineCollection({ loader: glob(...), schema: z.object({ ... }) })`",
            ));
        };
        let Some(a::Expression::ObjectExpression(options)) = call
            .arguments
            .first()
            .and_then(|e| e.as_expression())
            .map(|e| e.get_inner_expression())
        else {
            return Err(fail(call.span, "this collection", "pass `defineCollection` one object"));
        };
        let (mut loader, mut schema) = (None, None);
        for prop in &options.properties {
            if let a::ObjectPropertyKind::ObjectProperty(p) = prop {
                match p.key.static_name().as_deref() {
                    Some("loader") => loader = Some(&p.value),
                    Some("schema") => schema = Some(&p.value),
                    _ => {}
                }
            }
        }
        let Some(loader) = loader else {
            return Err(fail(
                call.span,
                &format!("collection `{name}` without a loader"),
                "add `loader: glob({ pattern: \"**/*.md\", base: \"./src/content/<name>\" })`",
            ));
        };
        if !matches!(called(loader), Some((_, "glob"))) {
            return Ok(None);
        }
        let sync = self.glob(loader, name)?;
        let Some(schema) = schema else {
            return Err(fail(
                call.span,
                &format!("collection `{name}` without a schema"),
                "add `schema: z.object({ title: z.string() })`: First needs the fields to make a kind",
            ));
        };
        let schema = match schema.get_inner_expression() {
            // `schema: ({ image }) => z.object(...)`: a helper it uses fails at that field.
            a::Expression::ArrowFunctionExpression(f) => match f.get_expression() {
                Some(e) => e,
                None => {
                    return Err(fail(
                        f.span,
                        "a schema function with a block body",
                        "return `z.object({ ... })` directly",
                    ));
                }
            },
            other => other,
        };
        let fields = self.object(schema)?;
        for f in &fields {
            if let Some((_, why)) = RESERVED.iter().find(|(r, _)| *r == f.name) {
                return Err(Diag::new(
                    self.at(f.span),
                    format!("field `{}` of `{name}` can't be a First field", f.name),
                )
                .help(format!("{why}; rename the field"))
                .code(Code::Schema));
            }
        }
        let title = ["title", "name", "heading"]
            .into_iter()
            .find(|t| fields.iter().any(|f| f.name == *t && f.text))
            .map(String::from)
            .ok_or_else(|| {
                fail(
                    schema.span(),
                    &format!("collection `{name}` without a title"),
                    "add `title: z.string()` (or `name`): a First kind has a title, the post's title in WordPress",
                )
            })?;
        Ok(Some(Collection {
            name: name.to_string(),
            sync,
            fields: fields
                .into_iter()
                .map(|f| Field {
                    name: f.name,
                    builder: f.builder,
                })
                .collect(),
            title,
        }))
    }

    /// `glob({ pattern, base })` → First's sync pattern for the base folder.
    fn glob(&self, loader: &a::Expression<'_>, name: &str) -> Result<String> {
        let fail = |s: oxc_span::Span, help: &str| {
            Diag::new(
                self.at(s),
                format!("the loader of `{name}` can't be read as a First kind's files"),
            )
            .help(help.to_string())
            .code(Code::Schema)
        };
        let a::Expression::CallExpression(call) = loader.get_inner_expression() else {
            return Err(fail(
                loader.span(),
                "use `glob({ pattern: \"**/*.md\", base: \"./src/content/<name>\" })`: First syncs a folder of Markdown files",
            ));
        };
        if !matches!(call.callee.get_inner_expression(), a::Expression::Identifier(i) if i.name == "glob") {
            return Err(fail(
                call.span,
                "use `glob({ pattern: \"**/*.md\", base: \"./src/content/<name>\" })`: First syncs a folder of Markdown files; a remote or `file()` loader has no files for it",
            ));
        }
        let Some(a::Expression::ObjectExpression(options)) = call
            .arguments
            .first()
            .and_then(|e| e.as_expression())
            .map(|e| e.get_inner_expression())
        else {
            return Err(fail(call.span, "pass `glob` one object: `{ pattern, base }`"));
        };
        let (mut pattern, mut base) = (None, None);
        for prop in &options.properties {
            let a::ObjectPropertyKind::ObjectProperty(p) = prop else {
                return Err(fail(prop.span(), "write `pattern` and `base` out"));
            };
            let value = match p.value.get_inner_expression() {
                a::Expression::StringLiteral(s) => s.value.to_string(),
                a::Expression::TemplateLiteral(t) if t.expressions.is_empty() && t.quasis.len() == 1 => {
                    t.quasis[0].value.raw.to_string()
                }
                other => return Err(fail(other.span(), "write the pattern and base as plain strings")),
            };
            match p.key.static_name().as_deref() {
                Some("pattern") => pattern = Some((value, p.value.span())),
                Some("base") => base = Some((value, p.value.span())),
                Some("generateId") => {
                    return Err(fail(
                        p.span,
                        "remove `generateId`: a First kind's entry is named by its file, its slug",
                    ));
                }
                _ => return Err(fail(p.span, "`glob` takes `pattern` and `base`")),
            }
        }
        let Some((pattern, pattern_span)) = pattern else {
            return Err(fail(call.span, "add `pattern: \"**/*.md\"`"));
        };
        // `*.md` reads the folder alone and `**/*.md` the folders below it too; both name an entry by
        // its path below the base, which a folder tree also does (`2024/post.md` is `2024/post`).
        if !matches!(pattern.as_str(), "**/*.md" | "**/[^_]*.md" | "*.md" | "[^_]*.md") {
            return Err(fail(
                pattern_span,
                &format!(
                    "the pattern `{pattern}` isn't one First syncs: use \"**/*.md\" (or \"*.md\"); First syncs Markdown files, and .mdx, .json and other patterns aren't read"
                ),
            ));
        }
        let base = base.unwrap_or_else(|| (".".to_string(), call.span));
        let dir = base.0.trim_start_matches("./").trim_end_matches('/');
        if dir.is_empty()
            || dir == "."
            || dir.starts_with('/')
            || dir
                .split('/')
                .any(|p| p == ".." || p.is_empty() || p.contains(['*', '\\', ':']))
        {
            return Err(fail(
                base.1,
                "set `base` to a folder inside the project, e.g. \"./src/content/blog\"",
            ));
        }
        Ok(format!("{dir}/**/*.md"))
    }

    /// `z.object({ ... })` → its fields.
    fn object(&self, schema: &a::Expression<'_>) -> Result<Vec<Mapped>> {
        let (base, chain) = self.chain(schema)?;
        if base.0 != "object" || !chain.is_empty() {
            return Err(Diag::new(
                self.at(schema.span()),
                "the schema in src/content.config.ts can't be read as a First kind",
            )
            .help("write it as `z.object({ ... })`; extend, merge, transforms and refinements aren't read")
            .code(Code::Schema));
        }
        let Some(a::Expression::ObjectExpression(shape)) = base
            .1
            .first()
            .and_then(|e| e.as_expression())
            .map(|e| e.get_inner_expression())
        else {
            return Err(Diag::new(
                self.at(schema.span()),
                "the schema in src/content.config.ts can't be read as a First kind",
            )
            .help("pass `z.object` an object of fields")
            .code(Code::Schema));
        };
        let mut out = Vec::new();
        for prop in &shape.properties {
            let a::ObjectPropertyKind::ObjectProperty(p) = prop else {
                return Err(Diag::new(
                    self.at(prop.span()),
                    "a spread in the schema can't be read as a First kind",
                )
                .help("write each field out")
                .code(Code::Schema));
            };
            let Some(name) = p.key.static_name().filter(|_| !p.computed) else {
                return Err(
                    Diag::new(self.at(p.span), "a computed field name can't be read as a First kind")
                        .help("name the field")
                        .code(Code::Schema),
                );
            };
            out.push(self.field(&name, &p.value)?);
        }
        Ok(out)
    }

    /// `z.<base>(args).<m>(args)...` → (base name and arguments, modifiers outward).
    #[allow(clippy::type_complexity)]
    fn chain<'b, 'a>(
        &self,
        e: &'b a::Expression<'a>,
    ) -> Result<(
        (String, &'b [a::Argument<'a>], oxc_span::Span),
        Vec<(String, &'b [a::Argument<'a>], oxc_span::Span)>,
    )> {
        let mut modifiers = Vec::new();
        let mut current = e.get_inner_expression();
        loop {
            let a::Expression::CallExpression(call) = current else {
                return Err(Diag::new(
                    self.at(current.span()),
                    "this field type can't be read as a First field",
                )
                .help("write fields with `z.` (`z.string()`, `z.number()`, ...)")
                .code(Code::Schema));
            };
            let m = match call.callee.get_inner_expression() {
                a::Expression::StaticMemberExpression(m) => m,
                // A helper Astro passes the schema function: `image()`, `reference("authors")`.
                a::Expression::Identifier(f) => {
                    let help = match f.name.as_str() {
                        "image" => {
                            "keep the image's URL as `z.string()` and the file in the media library or public/: an `image()` path is resolved by Astro's build, which First doesn't run"
                        }
                        "reference" => {
                            "keep the referenced entry's slug as `z.string()`, or declare the relation in first/ with ref()"
                        }
                        _ => "write the field with `z.`",
                    };
                    return Err(
                        Diag::new(self.at(call.span), format!("`{}()` has no First field type", f.name))
                            .help(help)
                            .code(Code::Schema),
                    );
                }
                _ => {
                    return Err(
                        Diag::new(self.at(call.span), "this field type can't be read as a First field")
                            .help("write fields with `z.` (`z.string()`, `z.number()`, ...)")
                            .code(Code::Schema),
                    );
                }
            };
            let name = m.property.name.to_string();
            match m.object.get_inner_expression() {
                a::Expression::Identifier(z) if z.name == "z" => {
                    modifiers.reverse();
                    return Ok(((name, call.arguments.as_slice(), call.span), modifiers));
                }
                // `z.coerce.date()`
                a::Expression::StaticMemberExpression(c)
                    if c.property.name == "coerce"
                        && matches!(c.object.get_inner_expression(), a::Expression::Identifier(z) if z.name == "z") =>
                {
                    modifiers.reverse();
                    return Ok((
                        (format!("coerce.{name}"), call.arguments.as_slice(), call.span),
                        modifiers,
                    ));
                }
                inner => {
                    modifiers.push((name, call.arguments.as_slice(), call.span));
                    current = inner;
                }
            }
        }
    }

    fn field(&self, name: &str, value: &a::Expression<'_>) -> Result<Mapped> {
        let refuse = |s: oxc_span::Span, what: String, help: &str| {
            Diag::new(self.at(s), format!("field `{name}`: {what} has no First field type"))
                .help(help.to_string())
                .code(Code::Schema)
        };
        let ((base, args, base_span), modifiers) = self.chain(value).map_err(|mut d| {
            d.message = format!("field `{name}`: {}", d.message);
            d
        })?;
        let mut optional = false;
        let mut default: Option<String> = None;
        let mut extra = String::new();
        let mut enum_values: Option<Vec<String>> = None;
        let (mut builder, text) = match base.as_str() {
            "string" => ("text()".to_string(), true),
            "number" | "coerce.number" => ("number()".to_string(), false),
            "boolean" | "coerce.boolean" => ("boolean()".to_string(), false),
            // Astro's own example: a date written `2022-07-08` or `'Jul 08 2022'` in front matter.
            // First stores a calendar date and reads `YYYY-MM-DD`; a sync with another form is refused
            // at the file, by the field's own check.
            "date" | "coerce.date" => ("date()".to_string(), false),
            "enum" => {
                let values = match args
                    .first()
                    .and_then(|e| e.as_expression())
                    .map(|e| e.get_inner_expression())
                {
                    Some(a::Expression::ArrayExpression(arr)) => arr
                        .elements
                        .iter()
                        .map(|el| match el.as_expression().map(|e| e.get_inner_expression()) {
                            Some(a::Expression::StringLiteral(s)) => Ok(s.value.to_string()),
                            _ => Err(refuse(
                                el.span(),
                                "an enum value that isn't a string".into(),
                                "list the values as strings",
                            )),
                        })
                        .collect::<Result<Vec<_>>>()?,
                    _ => {
                        return Err(refuse(
                            base_span,
                            "`z.enum` without a list of values".into(),
                            "write `z.enum([\"a\", \"b\"])`",
                        ));
                    }
                };
                if values.is_empty() {
                    return Err(refuse(base_span, "an empty `z.enum`".into(), "list at least one value"));
                }
                enum_values = Some(values);
                (String::new(), false)
            }
            "array" => {
                let item = args.first().and_then(|e| e.as_expression()).ok_or_else(|| {
                    refuse(
                        base_span,
                        "`z.array` without an item type".into(),
                        "write `z.array(z.string())`",
                    )
                })?;
                let ((item_base, item_args, item_span), item_mods) = self.chain(item)?;
                if !item_mods.is_empty() {
                    return Err(refuse(
                        item_span,
                        "a list item with modifiers".into(),
                        "write the item type plainly: `z.array(z.string())`",
                    ));
                }
                match item_base.as_str() {
                    "string" => ("json<string[]>()".to_string(), false),
                    "number" => ("json<number[]>()".to_string(), false),
                    "enum" => {
                        let Some(a::Expression::ArrayExpression(arr)) = item_args
                            .first()
                            .and_then(|e| e.as_expression())
                            .map(|e| e.get_inner_expression())
                        else {
                            return Err(refuse(
                                item_span,
                                "`z.enum` without a list of values".into(),
                                "write `z.array(z.enum([\"a\", \"b\"]))`",
                            ));
                        };
                        let mut values = Vec::new();
                        for el in &arr.elements {
                            match el.as_expression().map(|e| e.get_inner_expression()) {
                                Some(a::Expression::StringLiteral(s)) => values.push(format!("{:?}", s.value.as_str())),
                                _ => {
                                    return Err(refuse(
                                        el.span(),
                                        "an enum value that isn't a string".into(),
                                        "list the values as strings",
                                    ));
                                }
                            }
                        }
                        (format!("select([{}]).many()", values.join(", ")), false)
                    }
                    other => {
                        return Err(refuse(
                            item_span,
                            format!("a list of `z.{other}()`"),
                            "a list holds strings, numbers or enum values; keep other lists in first/ as a repeater()",
                        ));
                    }
                }
            }
            other => {
                let help = match other {
                    "object" => {
                        "a nested object has no plain field: declare the kind in first/ with group(), or flatten it"
                    }
                    "union" | "discriminatedUnion" | "intersection" => {
                        "a field holds one type: pick it, or declare the kind in first/"
                    }
                    "record" | "map" | "unknown" | "any" => {
                        "a field has a known type; use json() in a kind declared in first/"
                    }
                    "bigint" => "use z.number()",
                    "literal" => "use z.enum([...]) with the one value",
                    _ => {
                        "First maps z.string(), z.number(), z.boolean(), z.date(), z.enum() and z.array() of strings, numbers or enum values"
                    }
                };
                return Err(refuse(base_span, format!("`z.{other}()`"), help));
            }
        };
        let mut is_url = false;
        let mut is_email = false;
        for (m, margs, mspan) in &modifiers {
            let number = || -> Result<f64> {
                match margs
                    .first()
                    .and_then(|e| e.as_expression())
                    .map(|e| e.get_inner_expression())
                {
                    Some(a::Expression::NumericLiteral(n)) => Ok(n.value),
                    _ => Err(refuse(
                        *mspan,
                        format!("`.{m}()` with a value that isn't a number"),
                        "write a number literal",
                    )),
                }
            };
            match m.as_str() {
                "optional" | "nullable" | "nullish" => optional = true,
                "default" => {
                    let Some(v) = margs.first().and_then(|e| e.as_expression()) else {
                        return Err(refuse(
                            *mspan,
                            "`.default()` without a value".into(),
                            "write `.default(value)`",
                        ));
                    };
                    let s = v.span();
                    let text = &self.source[s.start as usize..s.end as usize];
                    match v.get_inner_expression() {
                        a::Expression::StringLiteral(_)
                        | a::Expression::NumericLiteral(_)
                        | a::Expression::BooleanLiteral(_) => default = Some(text.to_string()),
                        a::Expression::ArrayExpression(arr) if arr.elements.is_empty() => default = Some("[]".into()),
                        _ => {
                            return Err(refuse(
                                s,
                                "a default that isn't a plain value".into(),
                                "write a string, number, boolean or `[]`",
                            ));
                        }
                    }
                }
                "url" if base == "string" => is_url = true,
                "email" if base == "string" => is_email = true,
                "int" if base.ends_with("number") => builder = "integer()".into(),
                "min" | "max" if base.ends_with("number") || base == "string" => {
                    if base == "string" && m == "min" && number()? == 1.0 {
                        continue; // non-empty: First's required text
                    }
                    let _ = write!(extra, ".{m}({})", number()?);
                }
                "positive" if base.ends_with("number") => extra.push_str(".min(1)"),
                "nonnegative" if base.ends_with("number") => extra.push_str(".min(0)"),
                "describe" => {}
                other => {
                    return Err(refuse(
                        *mspan,
                        format!("`.{other}()` on `z.{base}()`"),
                        "First maps .optional(), .default(), .min(), .max(), .int(), .url() and .email(); transforms, refinements and other modifiers aren't read",
                    ));
                }
            }
        }
        if is_url {
            builder = "url()".into();
        }
        if is_email {
            builder = "email()".into();
        }
        if let Some(values) = enum_values {
            builder = format!(
                "select([{}])",
                values.iter().map(|v| format!("{v:?}")).collect::<Vec<_>>().join(", ")
            );
        }
        let mut out = format!("{builder}{extra}");
        match (&default, optional) {
            (Some(d), _) => {
                let _ = write!(out, ".default({d})");
            }
            (None, true) => out.push_str(".optional()"),
            (None, false) => {}
        }
        Ok(Mapped {
            name: name.to_string(),
            builder: out,
            text: text && !is_url && !is_email,
            span: oxc_span::Span::new(value.span().start, value.span().end),
        })
    }
}

struct Mapped {
    name: String,
    builder: String,
    /// A plain string: it can be the kind's title.
    text: bool,
    span: oxc_span::Span,
}
