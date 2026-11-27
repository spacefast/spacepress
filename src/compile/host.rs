//! Standard host globals, lowered onto the PHP runtime: the global `fetch` (`SpacePress\Fetch`),
//! `Response`/`Headers`/`URLSearchParams`, `process.env.NAME` (`SpacePress\Env`), `process.platform` and
//! `navigator.platform` (`SpacePress\Host`), the global `crypto`'s `randomUUID` (`SpacePress\Crypto`),
//! and the Node built-in modules and global `Buffer` (`SpacePress\Node\Module`), which are checked
//! JavaScript values in typed TypeScript as in imported JavaScript.
//!
//! Every outbound call, crypto call and environment read is reported to [`Compiler::host_use`]
//! before its PHP is emitted, so one function sees all of them. Forms that cannot be lowered
//! soundly are refused here with a location and a fix.
use super::*;
use crate::builtins::BuiltinModule;
use crate::types::HostTy;

/// What a host lowering reaches outside the handler.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HostUse<'n> {
    /// An outbound HTTP request (`fetch`), to the URL's static host when the source names one.
    Fetch(Option<&'n str>),
    /// A Node built-in module or Web Crypto function, by its standard name.
    Crypto(&'static str),
    /// A runtime variable read (`process.env.NAME`, or a `createHmac` key read from it).
    EnvRead(&'n str),
    /// The server's operating system, read when PHP runs: `process.platform` or `navigator.platform`.
    Platform(&'static str),
}

impl Compiler<'_, '_> {
    /// The one place every host effect passes through, before its PHP is emitted. A plugin's
    /// effects are recorded here as capabilities (`plugins::KINDS`): `http` with the static host
    /// (`*` when the URL is built at runtime) and `env` with the variable name.
    pub(super) fn host_use(&mut self, what: HostUse<'_>, span: Span) -> Result<()> {
        match what {
            HostUse::Fetch(host) => {
                if self.fx().db_mode.is_restricted() {
                    return err_help(
                        span,
                        "access rules can't use fetch()",
                        "move it into a hook, action or route",
                    );
                }
                self.uses("http", host.unwrap_or("*"), span);
            }
            HostUse::EnvRead(name) => {
                if reserved_env_name(name) {
                    return reserved_env_error(span, name);
                }
                self.uses("env", name, span)
            }
            // Hashing, random values and the platform name reach nothing outside the handler; no
            // capability.
            HostUse::Crypto(_) | HostUse::Platform(_) => {}
        }
        Ok(())
    }

    /// A plugin's fetches are checked against its locked hosts on every hop, so a runtime-built
    /// URL or a redirect can't leave the grant. A lock holding `*` answers null: any public host.
    fn fetch_hosts(&self) -> String {
        match &self.plugin {
            Some((i, _)) => format!(", \\SpacePressApp\\{}()", self.host_functions[*i]),
            None => String::new(),
        }
    }

    fn is_global(&mut self, e: &Expr, g: &str) -> bool {
        matches!(&e.kind, ExprKind::Ident(n) if n == g)
            && matches!(self.resolve(g, e.span), Ok(Resolved::Global(x)) if x == g)
    }

    fn is_process_env(&mut self, e: &Expr) -> bool {
        match &e.kind {
            ExprKind::Member { obj, prop, .. } if prop == "env" => self.is_global(obj, "process"),
            _ => false,
        }
    }

    /// `process.env.NAME` or `process.env["NAME"]`, possibly asserted (`!`, `as string`).
    fn env_name(&mut self, e: &Expr) -> Option<String> {
        match &e.kind {
            ExprKind::NonNull(x) | ExprKind::As(x, _) => self.env_name(x),
            ExprKind::Member { obj, prop, .. } if self.is_process_env(obj) => Some(prop.clone()),
            ExprKind::Index { obj, index, .. } if self.is_process_env(obj) => match &index.kind {
                ExprKind::Str(s) if is_env_name(s) => Some(s.clone()),
                _ => None,
            },
            _ => None,
        }
    }

    fn env_read(&mut self, name: &str, span: Span) -> Result<Out> {
        self.host_use(HostUse::EnvRead(name), span)?;
        Ok(Out::atom(
            format!(
                "(\\SpacePress\\Env::get({}) ?? \\SpacePress\\Js::undefined())",
                php_str(name)
            ),
            Ty::union([Ty::Str, Ty::Undefined]),
        ))
    }

    /// The Node built-in export `e` names: an imported binding, or a member of a module namespace.
    fn node_export(&mut self, e: &Expr) -> Result<Option<(BuiltinModule, &'static str)>> {
        match &e.kind {
            ExprKind::Ident(n) => Ok(match self.resolve(n, e.span) {
                Ok(Resolved::Value(Value::Builtin(Builtin::NodeModule(m, Some(f))), _)) => Some((m, f)),
                _ => None,
            }),
            ExprKind::Member {
                obj, prop, prop_span, ..
            } => match self.node_namespace(obj) {
                Some(m) => Ok(Some((m, m.export(prop, *prop_span)?))),
                None => Ok(None),
            },
            _ => Ok(None),
        }
    }

    fn node_namespace(&mut self, e: &Expr) -> Option<BuiltinModule> {
        match &e.kind {
            ExprKind::Ident(n) => match self.resolve(n, e.span) {
                Ok(Resolved::Value(Value::Builtin(Builtin::NodeModule(m, None)), _)) => Some(m),
                _ => None,
            },
            _ => None,
        }
    }

    /// A Node built-in module, or one of its exports, as a run-time value.
    pub(super) fn node_value(&self, module: BuiltinModule, export: Option<&str>) -> Out {
        let get = format!("\\SpacePress\\Node\\Module::get({})", php_str(module.name()));
        Out::atom(
            match export {
                Some(f) => format!("{get}->member({})", php_str(f)),
                None => get,
            },
            Ty::Dynamic,
        )
    }

    /// The global `Buffer`: `node:buffer`'s `Buffer`, as Node defines it.
    pub(super) fn buffer_value(&self) -> Out {
        self.node_value(BuiltinModule::Buffer, Some("Buffer"))
    }

    /// `process.platform` / `navigator.platform`: Node's names for the server's operating system,
    /// computed by PHP when it runs, never decided on the build machine.
    fn platform_read(&mut self, g: &'static str, span: Span) -> Result<Out> {
        let (what, method) = match g {
            "process" => ("process.platform", "platform"),
            _ => ("navigator.platform", "navigatorPlatform"),
        };
        self.host_use(HostUse::Platform(what), span)?;
        Ok(Out::atom(format!("\\SpacePress\\Host::{method}()"), Ty::Str))
    }

    /// Reads: `process.env.NAME`, `process.platform`, `navigator.platform`, and refusals for every
    /// other host member read.
    pub(super) fn host_member(&mut self, obj: &Expr, prop: &str, prop_span: Span) -> Result<Option<Out>> {
        if self.is_process_env(obj) {
            return self.env_read(prop, prop_span).map(Some);
        }
        if self.is_global(obj, "navigator") {
            return match prop {
                "platform" => self.platform_read("navigator", prop_span).map(Some),
                _ => Err(crate::eval::navigator_member_refusal(prop, prop_span)),
            };
        }
        if self.is_global(obj, "process") {
            return if prop == "platform" {
                self.platform_read("process", prop_span).map(Some)
            } else if prop == "env" {
                err_help(
                    Span {
                        end: prop_span.end,
                        ..obj.span
                    },
                    "`process.env` can only be read one variable at a time",
                    "write `process.env.NAME` or `process.env[\"NAME\"]`",
                )
            } else {
                err_help(
                    prop_span,
                    format!("`process.{prop}` isn't available in SpacePress code"),
                    "handlers run in PHP; only `process.env.NAME` and `process.platform` are supported",
                )
            };
        }
        if self.is_global(obj, "crypto") {
            return match prop {
                "subtle" => err_help(
                    prop_span,
                    "`crypto.subtle` isn't available in SpacePress code",
                    "hash with `createHash(\"sha256\").update(text).digest(\"hex\")` from \"node:crypto\"",
                ),
                "randomUUID" => err_help(
                    prop_span,
                    "`crypto.randomUUID` can't be used as a value",
                    "call it: `crypto.randomUUID()`",
                ),
                _ => self.web_crypto_refusal(prop, prop_span),
            };
        }
        if self.is_global(obj, "Buffer") {
            return Ok(Some(Out::atom(
                format!(
                    "\\SpacePress\\Js::dynamicGet({}, {})",
                    self.buffer_value().php,
                    php_str(prop)
                ),
                Ty::Dynamic,
            )));
        }
        if let Some(m) = self.node_namespace(obj) {
            let f = m.export(prop, prop_span)?;
            return Ok(Some(self.node_value(m, Some(f))));
        }
        Ok(None)
    }

    /// `process.env["NAME"]`; every other computed host read is refused.
    pub(super) fn host_index(&mut self, obj: &Expr, index: &Expr) -> Result<Option<Out>> {
        if self.is_process_env(obj) {
            return match &index.kind {
                ExprKind::Str(s) if is_env_name(s) => self.env_read(s, index.span).map(Some),
                _ => err_help(
                    index.span,
                    "`process.env` needs a literal variable name",
                    "write `process.env.NAME`; a computed name could let request input read any server variable",
                ),
            };
        }
        if ["process", "navigator", "crypto"]
            .iter()
            .any(|g| self.is_global(obj, g))
        {
            return err_help(
                index.span,
                "host objects can't be indexed",
                "use `process.env.NAME`, `process.platform` or `navigator.platform`",
            );
        }
        Ok(None)
    }

    /// Writes to `process.env` and other host objects.
    pub(super) fn host_place(&mut self, target: &Expr) -> Result<()> {
        if let ExprKind::Member { obj, .. } | ExprKind::Index { obj, .. } = &target.kind
            && (self.is_process_env(obj)
                || ["process", "navigator", "crypto", "Buffer"]
                    .iter()
                    .any(|g| self.is_global(obj, g)))
        {
            return err_help(
                target.span,
                "`process.env` and host objects are read-only in SpacePress code",
                "keep the value in a local variable or the database",
            );
        }
        Ok(())
    }

    /// Calls: `fetch`, `crypto.*`, Node built-in exports, `Buffer.*`, and refusals for `require`
    /// and `process.*`. None for every other call.
    pub(super) fn host_call(&mut self, callee: &Expr, args: &[ArrEl], span: Span) -> Result<Option<Out>> {
        if let Some((module, f)) = self.node_export(callee)? {
            return self.node_call(module, f, args, span).map(Some);
        }
        match &callee.kind {
            ExprKind::Ident(n) => match self.resolve(n, callee.span) {
                Ok(Resolved::Global("fetch")) => self.fetch_call(args, span).map(Some),
                Ok(Resolved::Global("require")) => err_help(
                    span,
                    "`require` only works at the top level of static CommonJS sources",
                    "use `import`, including `import { createHash } from \"node:crypto\"`",
                ),
                _ => Ok(None),
            },
            ExprKind::Member {
                obj, prop, prop_span, ..
            } => {
                if prop == "digest"
                    && let Some(out) = self.subtle_digest(obj, args, span)?
                {
                    return Ok(Some(out));
                }
                if self.is_global(obj, "crypto") {
                    return self.web_crypto_call(prop, args, *prop_span, span).map(Some);
                }
                if self.is_global(obj, "Buffer") {
                    let argv = self.javascript_args(args)?;
                    return Ok(Some(Out::atom(
                        format!(
                            "(\\SpacePress\\Js::dynamicMethod({}, {}))(...({argv})->a)",
                            self.buffer_value().php,
                            php_str(prop)
                        ),
                        Ty::Dynamic,
                    )));
                }
                if self.is_global(obj, "process") || self.is_process_env(obj) {
                    return err_help(
                        *prop_span,
                        format!("`{prop}` isn't available on `process` in SpacePress code"),
                        "handlers run in PHP; only `process.env.NAME` and `process.platform` are supported",
                    );
                }
                if self.is_global(obj, "navigator") {
                    return Err(crate::eval::navigator_member_refusal(prop, *prop_span));
                }
                Ok(None)
            }
            _ => Ok(None),
        }
    }

    /// A call of a Node built-in export, dispatched by the runtime module. A `createHmac` key
    /// read from `process.env.NAME` keeps the documented rule: trimmed, and refused when blank.
    fn node_call(&mut self, module: BuiltinModule, f: &'static str, args: &[ArrEl], span: Span) -> Result<Out> {
        self.host_use(HostUse::Crypto(f), span)?;
        let mut parts = Vec::new();
        for (i, arg) in args.iter().enumerate() {
            match arg {
                ArrEl::Item(e) if i == 1 && (module, f) == (BuiltinModule::Crypto, "createHmac") => {
                    if let Some(name) = self.env_name(e) {
                        self.host_use(HostUse::EnvRead(&name), e.span)?;
                        parts.push(format!("\\SpacePress\\Crypto::envKey({})", php_str(&name)));
                    } else {
                        let v = self.expr(e)?;
                        parts.push(self.finish_value(v, e.span)?.php);
                    }
                }
                ArrEl::Item(e) => {
                    let v = if matches!(e.kind, ExprKind::Undefined) {
                        Out::atom("\\SpacePress\\Js::undefined()", Ty::Dynamic)
                    } else {
                        self.expr(e)?
                    };
                    parts.push(self.finish_value(v, e.span)?.php);
                }
                ArrEl::Spread(e) => {
                    let v = self.expr(e)?;
                    parts.push(format!("...(\\SpacePress\\Js::dynamicIterable({}))->a", v.php));
                }
            }
        }
        Ok(Out::atom(
            format!(
                "\\SpacePress\\Node\\Module::get({})->call({}, [{}])",
                php_str(module.name()),
                php_str(f),
                parts.join(", ")
            ),
            Ty::Dynamic,
        ))
    }

    /// `new Headers(init)`. `URL`, `URLSearchParams` and `AbortController` are standard objects
    /// (`compile.rs`); other web constructors are refused.
    pub(super) fn host_new(&mut self, callee: &Expr, args: &[ArrEl], span: Span) -> Result<Option<Out>> {
        let ExprKind::Ident(n) = &callee.kind else {
            return Ok(None);
        };
        let Ok(Resolved::Global(g)) = self.resolve(n, callee.span) else {
            return Ok(None);
        };
        let (class, ty, ok): (&str, HostTy, fn(&Ty) -> bool) = match g {
            "Headers" => ("FetchHeaders", HostTy::Headers, header_init),
            "Request" => {
                return err_help(
                    span,
                    "`new Request` isn't available in SpacePress code",
                    "pass the URL and init to `fetch(url, init)`",
                );
            }
            "Response" => {
                return err_help(
                    span,
                    "`new Response` isn't available in SpacePress code",
                    "return a value, or `{ status, headers, body }` from a route",
                );
            }
            "FormData" | "Blob" => {
                return err_help(
                    span,
                    format!("`{g}` isn't available in SpacePress code"),
                    "send a string or URLSearchParams body",
                );
            }
            "Buffer" => {
                return err_help(
                    span,
                    "`new Buffer` is deprecated in Node",
                    "use `Buffer.from(value)` or `Buffer.alloc(size)`",
                );
            }
            _ => return Ok(None),
        };
        if args.len() > 1 {
            return err(span, format!("`new {g}` takes at most one argument"));
        }
        let init = match args.first() {
            None => "null".to_string(),
            Some(_) => {
                let e = self.arg(args, 0, span, "an init")?;
                let v = self.expr(e)?;
                let v = self.finish_value(v, e.span)?;
                if !ok(&v.ty) {
                    return err_help(
                        e.span,
                        format!("`new {g}` can't take {}", v.ty.describe()),
                        "pass an object of strings, an array of [name, value] string pairs, or another instance",
                    );
                }
                v.php
            }
        };
        Ok(Some(Out::atom(
            format!("(new \\SpacePress\\{class}({init}))"),
            Ty::Host(ty),
        )))
    }

    /// `fetch(url, init?)`, the standard signature, → `Promise<Response>`.
    fn fetch_call(&mut self, args: &[ArrEl], span: Span) -> Result<Out> {
        self.route_opaque("fetch");
        if args.is_empty() || args.len() > 2 {
            return err_help(
                span,
                "fetch() takes a URL and an optional init",
                "write fetch(url, { method, headers, body })",
            );
        }
        let url_expr = self.arg(args, 0, span, "a URL")?;
        let host = static_host(url_expr, |callee| self.is_global(callee, "URL"));
        self.host_use(HostUse::Fetch(host.as_deref()), url_expr.span)?;
        let url = self.expr(url_expr)?;
        let url = self.finish_value(url, url_expr.span)?;
        if !(text(&url.ty) || url.ty == Ty::Url) {
            return err_help(
                url_expr.span,
                format!("fetch() needs a URL string or URL, not {}", url.ty.describe()),
                "pass the URL as a string or a URL; Request objects aren't available in SpacePress code",
            );
        }
        // A WHATWG URL is fetch input as its href.
        let url_php = if url.ty == Ty::Url {
            format!("((string) {})", url.wrapped())
        } else {
            url.php.clone()
        };
        let init = match args.get(1) {
            None => "null".to_string(),
            Some(_) => {
                let init_expr = self.arg(args, 1, span, "init")?;
                // Only a GET or HEAD written out as such reads; any other method may change something
                // on the other side, so a query can't send it.
                let reads = match &init_expr.kind {
                    ExprKind::Object(props) => props.iter().all(|p| match p {
                        Prop::KV(PropKey::Static(k), v) if k == "method" => {
                            matches!(&v.kind, ExprKind::Str(m) if m.eq_ignore_ascii_case("GET") || m.eq_ignore_ascii_case("HEAD"))
                        }
                        _ => true,
                    }),
                    _ => false,
                };
                if !reads {
                    self.writes(init_expr.span, "sends a request that isn't a GET");
                }
                let mut spans = HashMap::new();
                if let ExprKind::Object(props) = &init_expr.kind {
                    for p in props {
                        match p {
                            Prop::KV(PropKey::Static(k), v) => {
                                init_key(k, v.span)?;
                                spans.insert(k.clone(), v.span);
                            }
                            Prop::KV(PropKey::Computed(k), _) => {
                                return err(k.span, "fetch() init keys must be written out");
                            }
                            Prop::Spread(e) => return err(e.span, "write fetch() init as one object literal"),
                            Prop::NullPrototype => {}
                        }
                    }
                }
                let init = self.expr(init_expr)?;
                let init = self.finish_value(init, init_expr.span)?;
                if init.ty == Ty::Dynamic {
                    // Checked JavaScript: SpacePress\Fetch::call refuses other keys and values at runtime.
                    return Ok(Out::atom(
                        format!(
                            "\\SpacePress\\Fetch::call({url_php}, {}{})",
                            init.php,
                            self.fetch_hosts()
                        ),
                        Ty::Promise(Box::new(Ty::Host(HostTy::Response))),
                    ));
                }
                let Ty::Obj(fields) = &init.ty else {
                    return err_help(
                        init_expr.span,
                        format!("fetch() init must be an object, not {}", init.ty.describe()),
                        "write fetch(url, { method, headers, body })",
                    );
                };
                for (k, (t, _)) in fields {
                    let at = spans.get(k).copied().unwrap_or(init_expr.span);
                    init_key(k, at)?;
                    init_value(k, t, at)?;
                }
                init.php
            }
        };
        Ok(Out::atom(
            format!("\\SpacePress\\Fetch::call({url_php}, {init}{})", self.fetch_hosts()),
            Ty::Promise(Box::new(Ty::Host(HostTy::Response))),
        ))
    }

    /// `crypto.subtle.digest(algorithm, data)` in imported JavaScript: a promise of an ArrayBuffer,
    /// as Web Crypto returns. files-sdk hashes upload bodies this way. Typed code keeps the
    /// `node:crypto` hash, which the refusal on `crypto.subtle` names.
    fn subtle_digest(&mut self, obj: &Expr, args: &[ArrEl], span: Span) -> Result<Option<Out>> {
        let ExprKind::Member { obj: crypto, prop, .. } = &obj.kind else {
            return Ok(None);
        };
        if prop != "subtle" || !self.is_global(crypto, "crypto") {
            return Ok(None);
        }
        if !self.javascript_module(self.fx.as_ref().expect("fn").module) {
            return err_help(
                span,
                "`crypto.subtle.digest` works in imported JavaScript only",
                "hash with `createHash(\"sha256\").update(text).digest(\"hex\")` from \"node:crypto\"",
            );
        }
        if args.len() != 2 || args.iter().any(|a| matches!(a, ArrEl::Spread(_))) {
            return err(span, "crypto.subtle.digest takes an algorithm and the data to hash");
        }
        self.host_use(HostUse::Crypto("subtle.digest"), span)?;
        let argv = self.javascript_args(args)?;
        Ok(Some(Out::atom(
            format!("\\SpacePress\\Crypto::subtleDigest(...({argv})->a)"),
            Ty::Dynamic,
        )))
    }

    fn web_crypto_call(&mut self, prop: &str, args: &[ArrEl], prop_span: Span, span: Span) -> Result<Out> {
        if prop != "randomUUID" {
            return self.web_crypto_refusal(prop, prop_span);
        }
        if !args.is_empty() {
            return err(span, "crypto.randomUUID() takes no arguments");
        }
        self.host_use(HostUse::Crypto("randomUUID"), span)?;
        Ok(Out::atom("\\SpacePress\\Crypto::randomUUID()", Ty::Str))
    }

    fn web_crypto_refusal<T>(&self, prop: &str, span: Span) -> Result<T> {
        match prop {
            "getRandomValues" => err_help(
                span,
                "`crypto.getRandomValues` needs typed arrays, which SpacePress doesn't compile",
                "use `randomBytes(n).toString(\"hex\")` from \"node:crypto\"",
            ),
            _ => err_help(
                span,
                format!("`crypto.{prop}` isn't available in SpacePress code"),
                "the global crypto has `randomUUID()`; import hashes and MACs from \"node:crypto\"",
            ),
        }
    }

    fn string_arg(&mut self, e: &Expr, call: &str, help: &str) -> Result<String> {
        let v = self.expr(e)?;
        let v = self.finish_value(v, e.span)?;
        if !text(&v.ty) {
            return err_help(e.span, format!("{call} needs a string, not {}", v.ty.describe()), help);
        }
        Ok(v.php)
    }

    fn host_strings(&mut self, args: &[ArrEl], n: usize, span: Span, call: &str) -> Result<Vec<String>> {
        if args.len() != n {
            return err(
                span,
                format!("{call}() takes {n} string argument{}", if n == 1 { "" } else { "s" }),
            );
        }
        (0..n)
            .map(|i| {
                let e = self.arg(args, i, span, "a string")?;
                self.string_arg(e, &format!("{call}()"), "pass a string")
            })
            .collect()
    }

    /// Property reads on `Response`, `Headers` and `URLSearchParams`.
    pub(super) fn host_property(&mut self, h: &HostTy, o: &Out, prop: &str, span: Span) -> Result<Out> {
        let field = |name: &str, ty: Ty| Ok(Out::atom(format!("{}->{name}", o.wrapped()), ty));
        match (h, prop) {
            (HostTy::Response, "status") => field("status", Ty::Num),
            (HostTy::Response, "statusText" | "url") => field(prop, Ty::Str),
            (HostTy::Response, "ok" | "redirected") => field(prop, Ty::Bool),
            (HostTy::Response, "bodyUsed") => field("bodyUsed()", Ty::Bool),
            (HostTy::Response, "headers") => field("headers", Ty::Host(HostTy::Headers)),
            (HostTy::Response, "body") => err_help(
                span,
                "response streams aren't available in SpacePress code",
                "read the body with `await response.text()` or `await response.json()`",
            ),
            (_, m) if host_methods(h).contains(&m) => err_help(
                span,
                format!("`{}.{m}` can't be used as a value", h.name()),
                format!("call it: `.{m}(...)`"),
            ),
            _ => {
                let mut d = Diag::new(
                    span,
                    format!("{} has no property `{prop}` in SpacePress code", h.name()),
                );
                let known: &[&str] = match h {
                    HostTy::Response => &["status", "statusText", "ok", "url", "redirected", "bodyUsed", "headers"],
                    _ => host_methods(h),
                };
                if let Some(s) = suggest(prop, known.iter().copied()) {
                    d = d.help(format!("did you mean `{s}`?"));
                }
                Err(d)
            }
        }
    }

    /// Method calls on `Response`, `Headers` and `URLSearchParams`.
    pub(super) fn host_method(
        &mut self,
        h: &HostTy,
        recv: &Out,
        m: &str,
        args: &[ArrEl],
        m_span: Span,
        span: Span,
    ) -> Result<Out> {
        let r = recv.wrapped();
        let call = |argv: &[String], ty: Ty| Ok(Out::atom(format!("{r}->{m}({})", argv.join(", ")), ty));
        match (h, m) {
            (HostTy::Response, "text" | "json") => {
                if !args.is_empty() {
                    return err(span, format!("{m}() takes no arguments"));
                }
                call(
                    &[],
                    Ty::Promise(Box::new(if m == "text" { Ty::Str } else { Ty::Unknown })),
                )
            }
            (HostTy::Response, "arrayBuffer" | "blob" | "bytes" | "formData") => err_help(
                m_span,
                "binary and form bodies aren't available in SpacePress code",
                "read the body with `await response.text()` or `await response.json()`",
            ),
            (HostTy::Response, "clone") => err_help(
                m_span,
                "responses can't be cloned in SpacePress code",
                "read the body once into a variable and use that",
            ),
            (HostTy::Headers, "get") => {
                let argv = self.host_strings(args, 1, span, m)?;
                call(&argv, Ty::Str.nullable())
            }
            (HostTy::Headers, "has") => {
                let argv = self.host_strings(args, 1, span, m)?;
                call(&argv, Ty::Bool)
            }
            (HostTy::Headers, "delete") => {
                let argv = self.host_strings(args, 1, span, m)?;
                call(&argv, Ty::Null)
            }
            (HostTy::Headers, "set" | "append") => {
                let argv = self.host_strings(args, 2, span, m)?;
                call(&argv, Ty::Null)
            }
            (HostTy::Headers, "forEach") => {
                if args.len() != 1 {
                    return err(span, "forEach() takes a callback");
                }
                let e = self.arg(args, 0, span, "a callback")?;
                let f = self.callback(e, &[Ty::Str, Ty::Str, Ty::Host(HostTy::Headers)])?;
                call(&[f.php], Ty::Null)
            }
            (HostTy::Headers, "entries" | "keys" | "values" | "getSetCookie") => err_help(
                m_span,
                format!("`Headers.{m}` isn't available in SpacePress code"),
                "walk them with `headers.forEach((value, name) => ...)`; set-cookie is never returned",
            ),
            _ => {
                let mut d = Diag::new(m_span, format!("{} has no method `{m}` in SpacePress code", h.name()));
                if let Some(s) = suggest(m, host_methods(h).iter().copied()) {
                    d = d.help(format!("did you mean `{s}`?"));
                }
                Err(d)
            }
        }
    }
}

fn host_methods(h: &HostTy) -> &'static [&'static str] {
    match h {
        HostTy::Response => &["text", "json"],
        HostTy::Headers => &["get", "has", "set", "append", "delete", "forEach"],
    }
}

/// A `RequestInit` key SpacePress lowers, or a located refusal with a fix.
fn init_key(key: &str, span: Span) -> Result<()> {
    match key {
        "method" | "headers" | "body" | "redirect" => Ok(()),
        "signal" => err_help(
            span,
            "fetch() `signal` isn't available in SpacePress code",
            "remove it; every call ends after 10 s",
        ),
        "credentials" | "mode" | "cache" | "referrer" | "referrerPolicy" | "integrity" | "keepalive" | "priority"
        | "window" | "duplex" | "dispatcher" => err_help(
            span,
            format!("fetch() `{key}` has no effect in a server-side request"),
            "remove it; SpacePress sends no cookies and keeps no HTTP cache",
        ),
        _ => {
            let mut d = Diag::new(span, format!("fetch() init has no option `{key}` in SpacePress code"));
            if let Some(s) = suggest(key, ["method", "headers", "body", "redirect"]) {
                d = d.help(format!("did you mean `{s}`?"));
            } else {
                d = d.help("fetch() takes method, headers, body and redirect");
            }
            Err(d)
        }
    }
}

fn absent(t: &Ty) -> bool {
    matches!(t, Ty::Null | Ty::Undefined)
}

fn init_value(key: &str, t: &Ty, span: Span) -> Result<()> {
    let ok = match key {
        "method" => t.all(|t| text(t) || absent(t)),
        "headers" => t.all(|t| header_init(t) || absent(t)),
        "body" => t.all(|t| text(t) || *t == Ty::UrlParams || absent(t)),
        "redirect" => t.all(|t| match t {
            Ty::StrLit(v) | Ty::FreshStrLit(v) => matches!(v.as_str(), "follow" | "manual" | "error"),
            t => text(t) || absent(t),
        }),
        _ => true,
    };
    if ok {
        return Ok(());
    }
    err_help(
        span,
        format!("fetch() `{key}` can't be {}", t.describe()),
        match key {
            "body" => {
                "send a string (JSON.stringify(value) for JSON) or URLSearchParams; Blob, FormData, ArrayBuffer and streams aren't available"
            }
            "headers" => "pass an object of strings, an array of [name, value] string pairs, or a Headers",
            "redirect" => "use \"follow\", \"manual\" or \"error\"",
            _ => "pass a string",
        },
    )
}

/// A string, or a checked-JavaScript value the runtime classes validate (they throw TypeError).
fn text(t: &Ty) -> bool {
    *t == Ty::Dynamic || t.is_str() && !t.is_nullable()
}

fn string_pairs(t: &Ty) -> bool {
    let pair = |t: &Ty| match t {
        Ty::Tuple(p) | Ty::ArrayLiteral(p) => p.len() == 2 && p.iter().all(text),
        Ty::Array(p) | Ty::NonEmptyArray(p) => text(p),
        _ => false,
    };
    match t {
        Ty::Array(el) | Ty::NonEmptyArray(el) => el.all(pair),
        Ty::Tuple(ts) | Ty::ArrayLiteral(ts) => ts.iter().all(pair),
        _ => false,
    }
}

fn string_record(t: &Ty) -> bool {
    match t {
        Ty::Obj(fields) => fields.values().all(|(t, optional)| !optional && text(t)),
        Ty::Map(v) => text(v),
        _ => false,
    }
}

fn header_init(t: &Ty) -> bool {
    *t == Ty::Dynamic || string_record(t) || string_pairs(t) || matches!(t, Ty::Host(HostTy::Headers))
}
