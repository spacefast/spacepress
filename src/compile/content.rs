//! `"first/content"`: navigation for a hierarchical kind's pages (docs/decisions/2026-11-13-docs-kind.md).
//!
//! - `nav(kind, current?)`: the kind's published items as a tree, siblings by `order` then title,
//!   each with its URL and whether it is, or holds, the current item;
//! - `pager(kind, current)`: the items before and after `current` in that tree, read top to bottom;
//! - `headings(item)`: the `##`–`###` headings of an item's content, with the anchor ids the page
//!   renders them with.
//!
//! The three run in PHP (`First\Content\Nav`), and read as the visitor like every query: a draft
//! or an item the visitor may not read is in no tree, pager or link.
use super::*;

pub const CONTENT_EXPORTS: &[&str] = &["nav", "pager", "headings"];
/// Type-only exports of `"first/content"`: importable, erased.
pub const CONTENT_TYPES: &[&str] = &["NavItem", "PagerLink", "Heading"];

/// The levels of tree `nav()` returns: the type system has no recursive types, so the tree is as
/// deep as this, and `nav()` stops there.
pub const NAV_DEPTH: usize = 4;

impl Compiler<'_, '_> {
    /// The `"first/content"` export an identifier names, if it does.
    pub(super) fn content_builtin(&mut self, e: &Expr) -> Result<Option<&'static str>> {
        let ExprKind::Ident(n) = &e.kind else { return Ok(None) };
        Ok(match self.resolve(n, e.span)? {
            Resolved::Value(Value::Builtin(Builtin::Content(name)), _) => Some(name),
            _ => None,
        })
    }

    /// A kind passed to `nav` or `pager`: a hierarchical collection with a url, named directly.
    fn content_kind(&mut self, args: &[ArrEl], span: Span, name: &str) -> Result<String> {
        let k = self.arg(args, 0, span, "a hierarchical kind")?;
        let v = self.expr(k)?;
        let Ty::Collection(table) = v.ty else {
            return err_help(
                k.span,
                format!("`{name}()` needs a kind, not {}", v.ty.describe()),
                "import the kind from \"first:db\" and pass it: `nav(docs)`",
            );
        };
        let c = &self.schema.collections[&table];
        if !c.hierarchical || c.url.is_none() {
            return err_help(
                k.span,
                format!("`{name}()` needs a hierarchical kind with a url; `{}` isn't one", c.key),
                "declare it with `hierarchical: true` and `url: \"/docs/:path\"`",
            );
        }
        let key = c.key.clone();
        self.uses("read", key, k.span);
        Ok(table)
    }

    /// The current item's id, from a number or a row (`item`, `item.id`).
    fn content_current(&mut self, e: &Expr, table: &str, name: &str) -> Result<String> {
        let v = self.expr(e)?;
        let v = self.finish_value(v, e.span)?;
        let row = types::row(self.schema, table);
        let nullable = Ty::union([Ty::Num, Ty::Null, Ty::Undefined]);
        if assignable(&v.ty, &nullable) {
            return Ok(v.php);
        }
        if assignable(&v.ty, &row) || assignable(&v.ty, &row.clone().nullable()) {
            return Ok(format!("\\First\\Content\\Nav::id({})", v.php));
        }
        err_help(
            e.span,
            format!("`{name}()` takes the current item or its id, not {}", v.ty.describe()),
            "pass the page's `item`, or `item.id`",
        )
    }

    pub(super) fn content_call(&mut self, name: &str, args: &[ArrEl], span: Span) -> Result<Out> {
        for a in args {
            if let ArrEl::Spread(x) = a {
                return err(x.span, "spread arguments aren't supported here");
            }
        }
        match name {
            "nav" => {
                if args.is_empty() || args.len() > 2 {
                    return err_help(
                        span,
                        "`nav()` takes a kind and the current item",
                        "call `nav(docs, item)`",
                    );
                }
                let table = self.content_kind(args, span, "nav")?;
                let current = match args.get(1) {
                    Some(ArrEl::Item(e)) => self.content_current(e, &table, "nav")?,
                    _ => "null".into(),
                };
                Ok(Out::atom(
                    format!(
                        "\\First\\Content\\Nav::tree({}, {current}, {NAV_DEPTH})",
                        php_str(&table)
                    ),
                    Ty::Promise(Box::new(Ty::Array(Box::new(nav_item(NAV_DEPTH))))),
                ))
            }
            "pager" => {
                if args.len() != 2 {
                    return err_help(
                        span,
                        "`pager()` takes a kind and the current item",
                        "call `pager(docs, item)`",
                    );
                }
                let table = self.content_kind(args, span, "pager")?;
                let ArrEl::Item(e) = &args[1] else {
                    unreachable!("spreads refused above")
                };
                let current = self.content_current(e, &table, "pager")?;
                let mut out = IndexMap::new();
                out.insert("prev".to_string(), (pager_link().nullable(), false));
                out.insert("next".to_string(), (pager_link().nullable(), false));
                Ok(Out::atom(
                    format!("\\First\\Content\\Nav::pager({}, {current})", php_str(&table)),
                    Ty::Promise(Box::new(Ty::Obj(out))),
                ))
            }
            "headings" => {
                if args.len() != 1 {
                    return err_help(span, "`headings()` takes the item", "call `headings(item)`");
                }
                let e = self.arg(args, 0, span, "an item")?;
                let v = self.expr(e)?;
                let v = self.finish_value(v, e.span)?;
                let content = self
                    .schema
                    .collections
                    .values()
                    .filter(|c| c.hierarchical)
                    .find_map(|c| {
                        let row = types::row(self.schema, &c.table);
                        (assignable(&v.ty, &row) || assignable(&v.ty, &row.nullable())).then(|| c.content.clone())
                    });
                let Some(Some(column)) = content else {
                    return err_help(
                        e.span,
                        format!(
                            "`headings()` takes an item of a hierarchical kind with content, not {}",
                            v.ty.describe()
                        ),
                        "pass the page's `item`",
                    );
                };
                Ok(Out::atom(
                    format!("\\First\\Content\\Nav::headings({}, {})", v.php, php_str(&column)),
                    Ty::Array(Box::new(heading())),
                ))
            }
            other => unreachable!("first/content has no export {other}"),
        }
    }
}

fn field(fields: &mut IndexMap<String, (Ty, bool)>, name: &str, ty: Ty) {
    fields.insert(name.to_string(), (ty, false));
}

/// `{ id, title, href, current, open, children }`, `depth` levels deep.
fn nav_item(depth: usize) -> Ty {
    let mut fields = IndexMap::new();
    field(&mut fields, "id", Ty::Num);
    field(&mut fields, "title", Ty::Str);
    field(&mut fields, "href", Ty::Str);
    field(&mut fields, "current", Ty::Bool);
    field(&mut fields, "open", Ty::Bool);
    if depth > 1 {
        field(&mut fields, "children", Ty::Array(Box::new(nav_item(depth - 1))));
    }
    Ty::Obj(fields)
}

/// `{ id, title, href }`.
fn pager_link() -> Ty {
    let mut fields = IndexMap::new();
    field(&mut fields, "id", Ty::Num);
    field(&mut fields, "title", Ty::Str);
    field(&mut fields, "href", Ty::Str);
    Ty::Obj(fields)
}

/// `{ depth, text, id }`.
fn heading() -> Ty {
    let mut fields = IndexMap::new();
    field(&mut fields, "depth", Ty::Num);
    field(&mut fields, "text", Ty::Str);
    field(&mut fields, "id", Ty::Str);
    Ty::Obj(fields)
}
