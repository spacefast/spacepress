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
            "Pagination" => &["page", "pages", "param", "className", "aria-label"],
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
            "Pagination" => {
                let mut arg = |k: &str, want: Ty, default: Option<&str>| -> Result<String> {
                    match get(k) {
                        None => default.map(str::to_string).ok_or_else(|| {
                            crate::diag::Diag::new(span, format!("`<Pagination>` needs `{k}`"))
                                .help("write `<Pagination page={search.page} pages={Math.ceil(total / 20)} />`")
                        }),
                        Some(v) => {
                            let out = self.expr(v)?;
                            let out = self.finish_value(out, v.span)?;
                            if !assignable(&out.ty, &want) {
                                return err(
                                    v.span,
                                    format!(
                                        "`<Pagination {k}>` takes {}, not {}",
                                        want.describe(),
                                        out.ty.describe()
                                    ),
                                );
                            }
                            Ok(out.php)
                        }
                    }
                };
                let page = arg("page", Ty::Num, None)?;
                let pages = arg("pages", Ty::Num, None)?;
                let param = arg("param", Ty::Str, Some("'page'"))?;
                let optional = Ty::union([Ty::Str, Ty::Null, Ty::Undefined]);
                let class = arg("className", optional.clone(), Some("null"))?;
                let label = arg("aria-label", optional, Some("null"))?;
                Ok(Out::atom(
                    format!("\\First\\Render\\Pagination::render({page}, {pages}, {param}, {class}, {label})"),
                    Ty::Html,
                ))
            }
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
