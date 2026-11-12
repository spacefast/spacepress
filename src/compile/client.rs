//! Generator B's server half (docs/decisions/2026-11-08-tsx-to-php.md): the first render of a
//! `"use client"` component is ordinary server HTML from generator A, with the Interactivity
//! directives added.
//!
//! The component's body is rewritten before it compiles: each `useState(x)` becomes `const v = x`,
//! setters, handlers, refs and effects are dropped (they run only in the browser), and derived
//! values stay as they are. The returned element then gets `data-wp-interactive`,
//! `data-wp-context` (state and props as JSON) and, wherever markup reads something the browser
//! can recompute, `data-wp-text` / `data-wp-bind--*` / `data-wp-class--*` / `data-wp-style--*`;
//! event attributes become `data-wp-on--*`. Generator A still prints every value, so the first
//! render matches React byte for byte once the `data-wp-*` attributes are set aside.
use super::*;
use crate::client_component::{Analysis, Binding};

/// The client component being compiled: its analysis, and whether the root element is still to come.
pub(super) struct ClientCtx {
    pub analysis: Analysis,
    pub root_pending: bool,
}

impl Compiler<'_, '_> {
    /// The server body of a client component: `useState` initial values as consts; everything
    /// that only runs in the browser left out.
    pub(super) fn client_server_body(stmts: &[Stmt], analysis: &Analysis) -> Vec<Stmt> {
        let mut out = Vec::new();
        for s in stmts {
            match s {
                Stmt::Decl {
                    pat: Pat::Arr { elems, .. },
                    init: Some(init),
                    span,
                    ..
                } if matches!(&init.kind, ExprKind::Call { .. })
                    && matches!(elems.first(), Some(Some(Pat::Id(..)))) =>
                {
                    let Some(Some(Pat::Id(name, nspan))) = elems.first() else {
                        unreachable!()
                    };
                    if let Some((_, initial)) = analysis.state.iter().find(|(n, _)| n == name) {
                        out.push(Stmt::Decl {
                            kind: DeclKind::Const,
                            pat: Pat::Id(name.clone(), *nspan),
                            ann: None,
                            init: Some(initial.clone()),
                            span: *span,
                        });
                    }
                }
                Stmt::Decl {
                    pat: Pat::Id(name, _), ..
                } if matches!(analysis.bindings.get(name), Some(Binding::Action | Binding::Ref)) => {}
                Stmt::Func(_) | Stmt::Expr(_) => {}
                other => out.push(clone_stmt(other)),
            }
        }
        out
    }

    /// Directive attributes for one intrinsic element of a client component: `entries` already
    /// holds the element's PHP attributes; `jsx` is its source. Returns extra PHP entries.
    pub(super) fn client_directives(&mut self, jsx: &Jsx) -> Result<Vec<String>> {
        let Some(ctx) = self.client.as_mut() else {
            return Ok(Vec::new());
        };
        let mut extra = Vec::new();
        if std::mem::take(&mut ctx.root_pending) {
            extra.push(format!("'data-wp-interactive' => {}", php_str(&ctx.analysis.namespace)));
            // The context: each useState value and each prop, as the browser starts from them.
            let mut fields = Vec::new();
            for (name, _) in &ctx.analysis.state {
                fields.push(name.clone());
            }
            for name in &ctx.analysis.props {
                if !fields.contains(name) {
                    fields.push(name.clone());
                }
            }
            let mut parts = Vec::new();
            for name in fields {
                let local = match self.resolve(&name, Span::NONE)? {
                    Resolved::Local(l) => l.php,
                    _ => continue,
                };
                parts.push(format!("{} => {local}", php_str(&name)));
            }
            extra.push(format!(
                "'data-wp-context' => \\First\\Islands::context({}, [{}])",
                php_str(&self.client.as_ref().expect("client").analysis.namespace),
                parts.join(", ")
            ));
            let ctx = self.client.as_ref().expect("client");
            for (target, event, action) in &ctx.analysis.events {
                extra.push(format!(
                    "{} => {}",
                    php_str(&format!("data-wp-on-{target}--{event}")),
                    php_str(&format!("actions.{action}"))
                ));
            }
            for (name, _) in &ctx.analysis.watch {
                extra.push(format!(
                    "{} => {}",
                    php_str(&format!("data-wp-watch--{name}")),
                    php_str(&format!("callbacks.{name}"))
                ));
            }
            for (name, _) in &ctx.analysis.init {
                extra.push(format!(
                    "{} => {}",
                    php_str(&format!("data-wp-init--{name}")),
                    php_str(&format!("callbacks.{name}"))
                ));
            }
        }
        for attr in &jsx.attrs {
            let JsxAttr::Named { name, value, span } = attr else {
                continue;
            };
            let folded = name.to_ascii_lowercase();
            let ctx = self.client.as_mut().expect("client");
            if folded.starts_with("on") && folded.len() > 2 {
                let event = folded[2..].to_string();
                let action = ctx.analysis.handler(value, &event)?;
                extra.push(format!(
                    "{} => {}",
                    php_str(&format!("data-wp-on--{event}")),
                    php_str(&format!("actions.{action}"))
                ));
                continue;
            }
            if name == "ref" {
                continue;
            }
            if !ctx.analysis.reactive(value) {
                continue;
            }
            let reference = self.client_reference(value)?;
            match name.as_str() {
                "className" if matches!(value.kind, ExprKind::Object(_)) => {
                    let ExprKind::Object(props) = &value.kind else {
                        unreachable!()
                    };
                    for p in props {
                        if let Prop::KV(PropKey::Static(class), v) = p {
                            let r = self.client_reference(v)?;
                            extra.push(format!(
                                "{} => {}",
                                php_str(&format!("data-wp-class--{class}")),
                                php_str(&r)
                            ));
                        }
                    }
                }
                "style" if matches!(value.kind, ExprKind::Object(_)) => {
                    let ExprKind::Object(props) = &value.kind else {
                        unreachable!()
                    };
                    for p in props {
                        if let Prop::KV(PropKey::Static(property), v) = p
                            && self.client.as_ref().expect("client").analysis.reactive(v)
                        {
                            let css: String = property
                                .chars()
                                .flat_map(|c| {
                                    if c.is_ascii_uppercase() {
                                        vec!['-', c.to_ascii_lowercase()]
                                    } else {
                                        vec![c]
                                    }
                                })
                                .collect();
                            let r = self.client_reference(v)?;
                            extra.push(format!(
                                "{} => {}",
                                php_str(&format!("data-wp-style--{css}")),
                                php_str(&r)
                            ));
                        }
                    }
                }
                _ => {
                    let attribute = match name.as_str() {
                        "className" => "class".to_string(),
                        "htmlFor" => "for".to_string(),
                        other => other.to_string(),
                    };
                    let _ = span;
                    extra.push(format!(
                        "{} => {}",
                        php_str(&format!("data-wp-bind--{attribute}")),
                        php_str(&reference)
                    ));
                }
            }
        }
        Ok(extra)
    }

    /// A reactive markup expression as one directive reference: a bare state/prop/derived name
    /// reads directly; anything else becomes a generated derived getter.
    pub(super) fn client_reference(&mut self, value: &Expr) -> Result<String> {
        let ctx = self.client.as_mut().expect("client");
        if let ExprKind::Ident(n) = &value.kind
            && let Some(r) = ctx.analysis.reference(n)
        {
            return Ok(r);
        }
        let name = format!("value{}", ctx.analysis.derived.len() + 1);
        ctx.analysis.derived.push((name.clone(), value.clone()));
        Ok(format!("state.{name}"))
    }

    /// A child expression of a client element: dynamic text gets `data-wp-text`. When it shares
    /// its parent with other children, it is wrapped in a `<span>` that carries only the directive
    /// (the record's rule), so the browser can replace exactly that text.
    pub(super) fn client_text(&mut self, child: &Expr, php: String, alone: bool) -> Result<(String, Option<String>)> {
        let Some(ctx) = self.client.as_ref() else {
            return Ok((php, None));
        };
        if !ctx.analysis.reactive(child) {
            return Ok((php, None));
        }
        let r = self.client_reference(child)?;
        if alone {
            return Ok((php, Some(r)));
        }
        // `data-first-text` marks the span as the compiler's, not the author's.
        Ok((
            format!(
                "\\First\\Html::element('span', ['data-wp-text' => {}, 'data-first-text' => ''], {php})",
                php_str(&r)
            ),
            None,
        ))
    }
}

fn clone_stmt(s: &Stmt) -> Stmt {
    match s {
        Stmt::Decl {
            kind,
            pat,
            ann,
            init,
            span,
        } => Stmt::Decl {
            kind: *kind,
            pat: pat.clone(),
            ann: ann.clone(),
            init: init.clone(),
            span: *span,
        },
        Stmt::Return(e, span) => Stmt::Return(e.clone(), *span),
        Stmt::TypeAlias { name, params, ty } => Stmt::TypeAlias {
            name: name.clone(),
            params: params.clone(),
            ty: ty.clone(),
        },
        _ => unreachable!("analysis admits only declarations, hooks and the return"),
    }
}
