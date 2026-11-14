//! `"first/app"` in compiled code (docs/spec/rendering.md §2–§4): `notFound()`, `redirect()`, and
//! the components `<Content>`, `<Html>` and `<Link>`. Pages call them; the app router
//! (`runtime/First/Wp/AppRouter.php`) catches what `notFound()` and `redirect()` throw.
use super::*;

impl Compiler<'_, '_> {
    /// The props the router passes a route file's default export (and its `metadata` function):
    /// `params` from the folder names above it, `search` from its `search` export, and for a
    /// layout, `children`.
    pub(super) fn app_props(&self, file: &str) -> Ty {
        let mut params = IndexMap::new();
        for (name, many) in crate::app::params_of(file) {
            let ty = if many { Ty::Array(Box::new(Ty::Str)) } else { Ty::Str };
            params.insert(name, (ty, false));
        }
        let mut props = IndexMap::new();
        props.insert("params".to_string(), (Ty::Obj(params), false));
        let app = self.schema.app.as_ref().expect("app routes");
        if let Some(search) = app.files.get(file).and_then(|f| f.search.as_ref()) {
            props.insert(
                "search".to_string(),
                (types::action_input(&search.fields, &types::json_ty), false),
            );
        }
        if file.ends_with("layout.tsx") {
            props.insert("children".to_string(), (Ty::Html, false));
        }
        // A page that serves a kind's URL receives its item, read as the visitor (spec §2.7).
        if let Some((kind, _)) = app
            .routes
            .iter()
            .find(|r| r.page.as_deref() == Some(file))
            .and_then(|r| r.kind.as_ref())
        {
            props.insert("item".to_string(), (types::row(self.schema, kind), false));
        }
        Ty::Obj(props)
    }

    /// Whether `ann` names a props type `"first/app"` exports.
    pub(super) fn app_props_annotation(&self, ann: &TyAnn, module: usize) -> bool {
        let TyAnn::Ref(name, _, _) = ann else { return false };
        self.ev_program().modules[module].body.iter().any(|stmt| match stmt {
            Stmt::Import { source, specs, .. } if source == crate::loader::APP_MODULE => specs.iter().any(|s| {
                s.local == *name
                    && matches!(&s.imported, ImportName::Named(n) if n == "PageProps" || n == "LayoutProps")
            }),
            _ => false,
        })
    }

    /// The `"first/app"` export an identifier names, if it does.
    pub(super) fn app_builtin(&mut self, e: &Expr) -> Result<Option<&'static str>> {
        let ExprKind::Ident(n) = &e.kind else { return Ok(None) };
        Ok(match self.resolve(n, e.span)? {
            Resolved::Value(Value::Builtin(Builtin::App(name)), _) => Some(name),
            _ => None,
        })
    }

    /// The registered name of the action `e` names (`subscribe` imported from `first/server.ts`), if
    /// it names one.
    pub(super) fn action_named(&mut self, e: &Expr) -> Result<Option<String>> {
        let ExprKind::Ident(n) = &e.kind else { return Ok(None) };
        Ok(match self.resolve(n, e.span)? {
            Resolved::Value(Value::Action(a), _) => self.action_values.get(&(Rc::as_ptr(&a) as usize)).cloned(),
            _ => None,
        })
    }

    /// `useFormState(subscribe)`: what the last no-JavaScript submit of that action's form left for
    /// this page (docs/spec/rendering.md §4.2), read once.
    fn use_form_state(&mut self, args: &[ArrEl], span: Span) -> Result<Out> {
        let help = "pass the action the form posts to: `useFormState(subscribe)`";
        let [ArrEl::Item(arg)] = args else {
            return err_help(span, "`useFormState()` takes the form's action", help);
        };
        let Some(action) = self.action_named(arg)? else {
            return err_help(
                arg.span,
                "`useFormState()` takes an action imported from your server code",
                help,
            );
        };
        let result = self.action_results.get(&action).cloned().unwrap_or(Ty::Unknown);
        let mut error = IndexMap::new();
        error.insert("code".to_string(), (Ty::Str, false));
        error.insert("message".to_string(), (Ty::Str, false));
        error.insert("fields".to_string(), (Ty::Map(Box::new(Ty::Str)), false));
        let mut state = IndexMap::new();
        state.insert("pending".to_string(), (Ty::Bool, false));
        state.insert("error".to_string(), (Ty::union([Ty::Obj(error), Ty::Null]), false));
        state.insert("result".to_string(), (Ty::union([result, Ty::Null]), false));
        state.insert("values".to_string(), (Ty::Map(Box::new(Ty::Str)), false));
        Ok(Out::atom(
            format!("\\First\\Render\\Forms::state({})", php_str(&action)),
            Ty::Obj(state),
        ))
    }

    /// `<Comments for={item} />`: the item's thread, read as the visitor, and a form that posts a
    /// comment without JavaScript (docs/decisions/2026-11-14-comments.md). The item's kind is the one
    /// whose row type it has; that kind must turn `comments` on, where its policy lives.
    fn comments_component(&mut self, item: Option<&Expr>, class: Option<&Expr>, span: Span) -> Result<Out> {
        let Some(item) = item else {
            return err_help(
                span,
                "`<Comments>` needs `for`",
                "write `<Comments for={item} />` with the item the thread is on",
            );
        };
        let v = self.expr(item)?;
        let v = self.finish_value(v, item.span)?;
        let mut kinds: Vec<&String> = self
            .schema
            .collections
            .iter()
            .filter(|(_, c)| v.ty.non_null() == types::row_of(c))
            .map(|(name, _)| name)
            .collect();
        kinds.dedup();
        let [kind] = kinds.as_slice() else {
            return err_help(
                item.span,
                format!("`<Comments for>` takes a row of a collection, not {}", v.ty.describe()),
                "pass the item a page reads, e.g. the `item` prop of a kind's page",
            );
        };
        let kind = (*kind).clone();
        if !self.schema.collections[&kind].comments {
            return err_help(
                item.span,
                format!("`{kind}` has comments off"),
                format!("turn them on where `{kind}` is declared: `collection({{ … }}, {{ comments: true }})`"),
            );
        }
        let class = match class {
            None => "null".to_string(),
            Some(c) => {
                let out = self.expr(c)?;
                let out = self.finish_value(out, c.span)?;
                if !assignable(&out.ty, &Ty::union([Ty::Str, Ty::Undefined, Ty::Null])) {
                    return err(
                        c.span,
                        format!("`<Comments className>` takes a string, not {}", out.ty.describe()),
                    );
                }
                out.php
            }
        };
        Ok(Out::atom(
            format!(
                "\\First\\Render\\CommentsView::render({}, {}, {class})",
                php_str(&kind),
                v.php
            ),
            Ty::Html,
        ))
    }

    /// `<Search>` (the form) and `<SearchResults>` (the visitor's matches): docs/decisions/2026-11-14-search.md.
    /// `kind` is a literal naming a collection with a URL to link results to; without it the search
    /// is site-wide. Nothing about what is searchable is a prop: that is each kind's own fields.
    fn search_component(&mut self, name: &str, named: &[(&str, &Expr)], span: Span) -> Result<Out> {
        let get = |k: &str| named.iter().find(|(n, _)| *n == k).map(|(_, v)| *v);
        let optional_string = Ty::union([Ty::Str, Ty::Null, Ty::Undefined]);
        let value = |this: &mut Self, k: &str, want: &Ty| -> Result<String> {
            match get(k) {
                None => Ok("null".into()),
                Some(v) => {
                    let out = this.expr(v)?;
                    let out = this.finish_value(out, v.span)?;
                    if !assignable(&out.ty, want) {
                        return err(
                            v.span,
                            format!("`<{name} {k}>` takes {}, not {}", want.describe(), out.ty.describe()),
                        );
                    }
                    Ok(out.php)
                }
            }
        };
        if name == "Search" {
            let action = match get("action") {
                None => "null".to_string(),
                Some(Expr {
                    kind: ExprKind::Str(path),
                    span: s,
                }) => {
                    if !path.starts_with('/') || path.starts_with("//") {
                        return err_help(
                            *s,
                            "`<Search action>` is a path on this site",
                            "write `action=\"/search\"`",
                        );
                    }
                    php_str(path)
                }
                Some(other) => {
                    return err_help(
                        other.span,
                        "`<Search action>` is a literal path",
                        "write `action=\"/search\"`",
                    );
                }
            };
            let label = value(self, "label", &optional_string)?;
            let placeholder = value(self, "placeholder", &optional_string)?;
            let class = value(self, "className", &optional_string)?;
            return Ok(Out::atom(
                format!("\\First\\Render\\SearchView::form({action}, {label}, {placeholder}, {class})"),
                Ty::Html,
            ));
        }
        let kind = match get("kind") {
            None => "null".to_string(),
            Some(Expr {
                kind: ExprKind::Str(k),
                span: s,
            }) => {
                let Some((collection, c)) = self.schema.collections.iter().find(|(n, c)| *n == k || &c.key == k) else {
                    return err_help(
                        *s,
                        format!("there is no kind `{k}` to search"),
                        "name a collection the app exports",
                    );
                };
                if c.url.is_none() {
                    return err_help(
                        *s,
                        format!("`{k}` has no url for a result to link to"),
                        "give the kind a url, or render the rows yourself with `kind.list({ search })`",
                    );
                }
                php_str(collection)
            }
            Some(other) => {
                return err_help(
                    other.span,
                    "`<SearchResults kind>` is a literal kind name",
                    "write `kind=\"notes\"`, or leave it out to search every kind",
                );
            }
        };
        if get("q").is_none() {
            return err_help(
                span,
                "`<SearchResults>` needs `q`",
                "add `export const search = { q: text().optional() }` to the page, then pass `q={search.q}`",
            );
        }
        let q = value(self, "q", &optional_string)?;
        let number = Ty::union([Ty::Num, Ty::Null, Ty::Undefined]);
        let page = value(self, "page", &number)?;
        let per_page = value(self, "perPage", &number)?;
        let class = value(self, "className", &optional_string)?;
        Ok(Out::atom(
            format!("\\First\\Render\\SearchView::results({kind}, {q}, {page}, {per_page}, {class})"),
            Ty::Html,
        ))
    }

    /// `notFound()` and `redirect(url, status?)`: they never return.
    pub(super) fn app_call(&mut self, name: &str, args: &[ArrEl], span: Span) -> Result<Out> {
        match name {
            "useFormState" => self.use_form_state(args, span),
            "notFound" => {
                if !args.is_empty() {
                    return err_help(span, "`notFound()` takes no arguments", "call `notFound()`");
                }
                Ok(Out::atom("\\First\\Render\\Halt::notFound()", Ty::Never))
            }
            "redirect" => {
                if args.is_empty() || args.len() > 2 {
                    return err_help(
                        span,
                        "`redirect()` takes a URL and an optional status",
                        "call `redirect(\"/login\")` or `redirect(url, 301)`",
                    );
                }
                let url = self.arg(args, 0, span, "a URL")?;
                if let ExprKind::Str(literal) = &url.kind
                    && !safe_url(literal)
                {
                    return err_help(
                        url.span,
                        format!("\"{literal}\" isn't a URL a page can redirect to"),
                        "use a path like \"/login\" or an http(s) URL",
                    );
                }
                let u = self.expr(url)?;
                let u = self.finish_value(u, url.span)?;
                if !assignable(&u.ty, &Ty::Str) {
                    return err(
                        url.span,
                        format!("`redirect()` needs a string URL, not {}", u.ty.describe()),
                    );
                }
                let status = match args.get(1) {
                    None => "302".to_string(),
                    Some(ArrEl::Item(e)) => {
                        let v = match &e.kind {
                            ExprKind::Num(n) if [301.0, 302.0, 303.0, 307.0, 308.0].contains(n) => *n as i64,
                            _ => {
                                return err_help(
                                    e.span,
                                    "a redirect status is 301, 302, 303, 307 or 308",
                                    "write the status as a number literal",
                                );
                            }
                        };
                        v.to_string()
                    }
                    Some(ArrEl::Spread(x)) => return err(x.span, "spread arguments aren't supported here"),
                };
                Ok(Out::atom(
                    format!("\\First\\Render\\Halt::redirect({}, {status})", u.php),
                    Ty::Never,
                ))
            }
            other => err_help(
                span,
                format!("`{other}` is a component"),
                format!("render it as JSX: `<{other} … />`"),
            ),
        }
    }

    /// `<Content value>`, `<Html value>` and `<Link href>`: the props object is the JSX's.
    pub(super) fn app_component(&mut self, name: &str, props: &Expr, span: Span) -> Result<Out> {
        let ExprKind::Object(fields) = &props.kind else {
            unreachable!("lowering builds a props object literal")
        };
        let mut named: Vec<(&str, &Expr)> = Vec::new();
        for p in fields {
            match p {
                Prop::KV(PropKey::Static(k), v) => named.push((k.as_str(), v)),
                Prop::Spread(x) => {
                    return err_help(
                        x.span,
                        format!("`<{name}>` takes no spread props"),
                        "write each prop out",
                    );
                }
                _ => return err(span, format!("`<{name}>` takes named props")),
            }
        }
        let allowed: &[&str] = match name {
            "Content" | "Html" => &["value"],
            "Comments" => &["for", "className"],
            "Search" => &["action", "label", "placeholder", "className"],
            "SearchResults" => &["kind", "q", "page", "perPage", "className"],
            "Link" => &[
                "href",
                "children",
                "className",
                "prefetch",
                "id",
                "title",
                "rel",
                "target",
                "aria-current",
            ],
            _ => &[],
        };
        for (k, v) in &named {
            if !allowed.contains(k) {
                return err_help(
                    v.span,
                    format!("`<{name}>` has no prop `{k}`"),
                    format!("use {}", allowed.join(", ")),
                );
            }
        }
        let get = |k: &str| named.iter().find(|(n, _)| *n == k).map(|(_, v)| *v);
        match name {
            "Comments" => self.comments_component(get("for"), get("className"), span),
            "Search" | "SearchResults" => self.search_component(name, &named, span),
            "Content" | "Html" => {
                let Some(value) = get("value") else {
                    return err_help(
                        span,
                        format!("`<{name}>` needs `value`"),
                        format!("write `<{name} value={{…}} />`"),
                    );
                };
                // A literal is the author's own markup; anything else is data and goes through kses.
                let trusted = name == "Html" && matches!(value.kind, ExprKind::Str(_) | ExprKind::Template(..));
                let v = self.expr(value)?;
                let v = self.finish_value(v, value.span)?;
                if !assignable(&v.ty, &Ty::union([Ty::Str, Ty::Undefined, Ty::Null])) {
                    return err(
                        value.span,
                        format!("`<{name} value>` takes a string, not {}", v.ty.describe()),
                    );
                }
                let f = match (name, trusted) {
                    ("Content", _) => "content",
                    (_, true) => "trusted",
                    _ => "kses",
                };
                Ok(Out::atom(format!("\\First\\Render\\Markup::{f}({})", v.php), Ty::Html))
            }
            "Link" => {
                let Some(href) = get("href") else {
                    return err_help(
                        span,
                        "`<Link>` needs `href`",
                        "write `<Link href=\"/about\">About</Link>`",
                    );
                };
                if let ExprKind::Str(literal) = &href.kind
                    && !safe_url(literal)
                {
                    return err_help(
                        href.span,
                        format!("\"{literal}\" isn't a URL a link can point to"),
                        "use a path like \"/about\", or an http(s) or mailto URL",
                    );
                }
                let mut attrs = Vec::new();
                for (k, v) in &named {
                    if *k == "children" {
                        continue;
                    }
                    let out = self.expr(v)?;
                    let out = self.finish_value(out, v.span)?;
                    let want = if *k == "prefetch" {
                        Ty::Bool
                    } else {
                        Ty::union([Ty::Str, Ty::Null, Ty::Undefined])
                    };
                    if !assignable(&out.ty, &want) {
                        return err(
                            v.span,
                            format!("`<Link {k}>` takes {}, not {}", want.describe(), out.ty.describe()),
                        );
                    }
                    attrs.push(format!("{} => {}", php_str(k), out.php));
                }
                let children = match get("children") {
                    Some(c) => {
                        let v = self.expr(c)?;
                        let v = self.finish_value(v, c.span)?;
                        self.jsx_child_type(&v.ty, c.span)?;
                        v.php
                    }
                    None => "null".into(),
                };
                Ok(Out::atom(
                    format!("\\First\\Render\\Markup::link([{}], {children})", attrs.join(", ")),
                    Ty::Html,
                ))
            }
            _ => unreachable!("only components reach here"),
        }
    }
}
