//! `first mcp [dir] [--allow-remote-read] [--allow-writes]`: the project in `dir` for a coding
//! agent, as a Model Context Protocol server on stdin and stdout.
//!
//! This is the development-time half. The running site serves its own data and actions as a second
//! MCP server (`/wp-json/mcp/first-<app>`, docs/agents.md); this one answers about the project's
//! source: its schema, the compiler's diagnostics, First's documentation, the command table and the
//! local dev site.
//!
//! The wire format is the specification's stdio transport: one JSON-RPC 2.0 message per line, and
//! nothing else on stdout. Two revisions of the protocol are served, chosen by how the client opens:
//!
//! - 2026-07-28: no handshake. Every request names its protocol version and the client's
//!   capabilities in `params._meta`, and `server/discover` answers what this server supports.
//! - 2025-11-25 and 2025-06-18: the `initialize` handshake, then requests without that metadata.
//!
//! A request that does neither is refused, so no method is ever answered under a guessed revision.
//! Requests are answered one at a time, in the order they arrive.

mod docs;
mod tools;

use serde_json::{Map, Value, json};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::process::ExitCode;

/// Revisions without a handshake, newest first.
const MODERN: &[&str] = &["2026-07-28"];
/// Revisions that open with `initialize`, newest first. 2025-03-26 and earlier are not served: they
/// oblige a server to accept JSON-RPC batches.
const LEGACY: &[&str] = &["2025-11-25", "2025-06-18"];

const PROTOCOL_VERSION: &str = "io.modelcontextprotocol/protocolVersion";
const CLIENT_CAPABILITIES: &str = "io.modelcontextprotocol/clientCapabilities";
const SERVER_INFO: &str = "io.modelcontextprotocol/serverInfo";
const SUBSCRIPTION_ID: &str = "io.modelcontextprotocol/subscriptionId";

// JSON-RPC 2.0, and the codes the specification adds.
const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;
const INTERNAL_ERROR: i64 = -32603;
const UNSUPPORTED_PROTOCOL_VERSION: i64 = -32022;
/// "Resource not found" through 2025-11-25; later revisions answer `INVALID_PARAMS`.
const LEGACY_RESOURCE_NOT_FOUND: i64 = -32002;

/// The tool list, the documentation and what `server/discover` says never change while the process
/// runs, so a client may keep them this long.
const FIXED_TTL_MS: u64 = 3_600_000;

const USAGE: &str = "usage: first mcp [dir] [--allow-remote-read] [--allow-writes]";

pub(crate) struct Options {
    /// The project directory, canonical.
    pub(crate) project: PathBuf,
    /// `query` may read a site other than this project's dev site.
    pub(crate) allow_remote_read: bool,
    /// The write tools are listed, for this project's dev site only.
    pub(crate) allow_writes: bool,
}

struct RpcError {
    code: i64,
    message: String,
    data: Option<Value>,
}

impl RpcError {
    fn new(code: i64, message: impl Into<String>) -> Self {
        RpcError {
            code,
            message: message.into(),
            data: None,
        }
    }

    fn data(mut self, data: Value) -> Self {
        self.data = Some(data);
        self
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Era {
    Modern,
    Legacy,
}

pub(crate) fn cli(args: &[String]) -> ExitCode {
    let mut options = Options {
        project: PathBuf::from("."),
        allow_remote_read: false,
        allow_writes: false,
    };
    for arg in args {
        match arg.as_str() {
            "--allow-remote-read" => options.allow_remote_read = true,
            "--allow-writes" => options.allow_writes = true,
            other if other.starts_with('-') => {
                eprintln!("unknown option {other} for first mcp\n{USAGE}");
                return ExitCode::from(2);
            }
            other => options.project = PathBuf::from(other),
        }
    }
    options.project = match options.project.canonicalize() {
        Ok(project) => project,
        Err(error) => {
            eprintln!("{}: {error}\n{USAGE}", options.project.display());
            return ExitCode::from(2);
        }
    };
    let mut server = Server {
        options,
        initialized: false,
    };
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        // End of input, or input that is not text: the client is gone.
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        for message in server.receive(&line) {
            // A message is one line: serde_json escapes every newline inside a string.
            if writeln!(stdout, "{message}").and_then(|()| stdout.flush()).is_err() {
                return ExitCode::SUCCESS;
            }
        }
    }
    ExitCode::SUCCESS
}

struct Server {
    options: Options,
    /// A client opened with `initialize`: its later requests carry no per-request metadata.
    initialized: bool,
}

/// Runs one request's work. A compiler bug must not take the server down with it: the panic's
/// message goes to stderr, the client gets an error for this request, and the next one is answered
/// as usual.
fn contained<T>(method: &str, work: impl FnOnce() -> Result<T, RpcError>) -> Result<T, RpcError> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(work)).unwrap_or_else(|_| {
        Err(RpcError::new(
            INTERNAL_ERROR,
            format!("Internal error while answering {method}"),
        ))
    })
}

fn failure(id: Option<&Value>, error: RpcError) -> Value {
    let mut body = json!({ "code": error.code, "message": error.message });
    if let Some(data) = error.data {
        body["data"] = data;
    }
    let mut message = json!({ "jsonrpc": "2.0", "error": body });
    // An id that could not be read is left out; the specification forbids a null one.
    if let Some(id) = id {
        message["id"] = id.clone();
    }
    message
}

impl Server {
    fn info() -> Value {
        json!({ "name": "first", "title": "First", "version": env!("CARGO_PKG_VERSION") })
    }

    fn capabilities() -> Value {
        // No `listChanged` and no `subscribe`: neither list changes while the process runs.
        json!({ "tools": {}, "resources": {} })
    }

    fn instructions(&self) -> String {
        format!(
            "Development-time tools for the First project in {}. Call `schema` before changing kinds, actions or pages, \
             `check` after every edit, and `docs_search` before guessing an API: the documentation is the one this \
             compiler was built with. `query` reads the local dev site. The running site's own data and actions are a \
             different MCP server, at /wp-json/mcp/first-<app> on the site.",
            self.options.project.display()
        )
    }

    /// One line from the client: the messages to write back, none for a notification.
    fn receive(&mut self, line: &str) -> Vec<Value> {
        let Ok(message) = serde_json::from_str::<Value>(line) else {
            return vec![failure(None, RpcError::new(PARSE_ERROR, "Parse error: not JSON"))];
        };
        let Some(request) = message.as_object() else {
            let what = if message.is_array() {
                "JSON-RPC batches are not part of the protocol revisions this server speaks"
            } else {
                "a message is a JSON object"
            };
            return vec![failure(
                None,
                RpcError::new(INVALID_REQUEST, format!("Invalid request: {what}")),
            )];
        };
        let id = request.get("id");
        if id.is_some_and(|id| !(id.is_string() || id.is_i64() || id.is_u64())) {
            return vec![failure(
                None,
                RpcError::new(INVALID_REQUEST, "Invalid request: id is a string or an integer"),
            )];
        }
        let Some(method) = request.get("method").and_then(Value::as_str) else {
            // A response. This server sends no requests, so there is nothing it answers.
            return Vec::new();
        };
        if request.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
            return match id {
                Some(_) => vec![failure(
                    id,
                    RpcError::new(INVALID_REQUEST, "Invalid request: jsonrpc is \"2.0\""),
                )],
                None => Vec::new(),
            };
        }
        let Some(id) = id else {
            // A notification is never answered. `notifications/initialized` needs nothing, and
            // `notifications/cancelled` names a request that has already been answered, because
            // requests are answered in order.
            return Vec::new();
        };
        let empty = Map::new();
        let params = match request.get("params") {
            None => &empty,
            Some(Value::Object(params)) => params,
            Some(_) => {
                return vec![failure(
                    Some(id),
                    RpcError::new(INVALID_PARAMS, "Invalid params: params is an object"),
                )];
            }
        };
        match contained(method, || self.request(id, method, params)) {
            Ok(messages) => messages,
            Err(error) => vec![failure(Some(id), error)],
        }
    }

    /// The revision a request is made under, from its metadata or the handshake before it.
    fn era(&self, method: &str, params: &Map<String, Value>) -> Result<Era, RpcError> {
        let meta = params.get("_meta").and_then(Value::as_object);
        if let Some(requested) = meta.and_then(|meta| meta.get(PROTOCOL_VERSION)) {
            let supported = requested.as_str().is_some_and(|version| MODERN.contains(&version));
            if !supported {
                return Err(
                    RpcError::new(UNSUPPORTED_PROTOCOL_VERSION, "Unsupported protocol version")
                        .data(json!({ "supported": MODERN, "requested": requested })),
                );
            }
            if !meta.is_some_and(|meta| meta.get(CLIENT_CAPABILITIES).is_some_and(Value::is_object)) {
                return Err(RpcError::new(
                    INVALID_PARAMS,
                    format!("Invalid params: params._meta needs {CLIENT_CAPABILITIES}"),
                ));
            }
            return Ok(Era::Modern);
        }
        // `ping` may come before the handshake completes.
        if self.initialized || matches!(method, "initialize" | "ping") {
            return Ok(Era::Legacy);
        }
        Err(RpcError::new(
            INVALID_PARAMS,
            format!(
                "Invalid params: this request names no protocol version. Send {PROTOCOL_VERSION} in params._meta ({}), or open with initialize ({})",
                MODERN.join(", "),
                LEGACY.join(", ")
            ),
        )
        .data(json!({ "supported": ([MODERN, LEGACY].concat()) })))
    }

    fn request(&mut self, id: &Value, method: &str, params: &Map<String, Value>) -> Result<Vec<Value>, RpcError> {
        let era = self.era(method, params)?;
        let done = |mut result: Value, cacheable: bool| {
            if era == Era::Modern {
                result["resultType"] = json!("complete");
                result["_meta"] = json!({ SERVER_INFO: Self::info() });
                if cacheable {
                    result["ttlMs"] = json!(FIXED_TTL_MS);
                    result["cacheScope"] = json!("public");
                }
            }
            Ok(vec![json!({ "jsonrpc": "2.0", "id": id, "result": result })])
        };
        // The lists fit one page, so no cursor is ever handed out and none is valid.
        let one_page = || match params.get("cursor") {
            None | Some(Value::Null) => Ok(()),
            Some(_) => Err(RpcError::new(INVALID_PARAMS, "Invalid params: unknown cursor")),
        };
        match (era, method) {
            (Era::Legacy, "initialize") => {
                let requested = params
                    .get("protocolVersion")
                    .and_then(Value::as_str)
                    .ok_or_else(|| RpcError::new(INVALID_PARAMS, "Invalid params: initialize needs protocolVersion"))?;
                // The requested revision when this server speaks it, otherwise its newest with a handshake.
                let version = LEGACY.iter().find(|v| **v == requested).unwrap_or(&LEGACY[0]);
                self.initialized = true;
                done(
                    json!({
                        "protocolVersion": version,
                        "capabilities": Self::capabilities(),
                        "serverInfo": Self::info(),
                        "instructions": self.instructions(),
                    }),
                    false,
                )
            }
            (Era::Legacy, "ping") => done(json!({}), false),
            (Era::Modern, "server/discover") => done(
                json!({
                    "supportedVersions": MODERN,
                    "capabilities": Self::capabilities(),
                    "instructions": self.instructions(),
                }),
                true,
            ),
            (Era::Modern, "subscriptions/listen") => {
                // Nothing this server lists ever changes, so the stream it opens honours no
                // notification type and stays silent until the client cancels it or leaves.
                Ok(vec![json!({
                    "jsonrpc": "2.0",
                    "method": "notifications/subscriptions/acknowledged",
                    "params": { "_meta": { SUBSCRIPTION_ID: id }, "notifications": {} },
                })])
            }
            (_, "tools/list") => {
                one_page()?;
                done(json!({ "tools": tools::list(&self.options) }), true)
            }
            (_, "tools/call") => {
                let name = params
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| RpcError::new(INVALID_PARAMS, "Invalid params: tools/call needs name"))?;
                let arguments = match params.get("arguments") {
                    None | Some(Value::Null) => Map::new(),
                    Some(Value::Object(arguments)) => arguments.clone(),
                    Some(_) => return Err(RpcError::new(INVALID_PARAMS, "Invalid params: arguments is an object")),
                };
                let result = tools::call(&self.options, name, &arguments)?;
                done(result, false)
            }
            (_, "resources/list") => {
                one_page()?;
                done(json!({ "resources": docs::pages() }), true)
            }
            (_, "resources/templates/list") => {
                one_page()?;
                done(json!({ "resourceTemplates": [] }), true)
            }
            (_, "resources/read") => {
                let uri = params
                    .get("uri")
                    .and_then(Value::as_str)
                    .ok_or_else(|| RpcError::new(INVALID_PARAMS, "Invalid params: resources/read needs uri"))?;
                let Some((path, text)) = docs::find(uri) else {
                    let code = if era == Era::Modern {
                        INVALID_PARAMS
                    } else {
                        LEGACY_RESOURCE_NOT_FOUND
                    };
                    return Err(RpcError::new(code, "Resource not found").data(json!({ "uri": uri })));
                };
                done(
                    json!({ "contents": [{ "uri": docs::uri(path), "mimeType": "text/markdown", "text": text }] }),
                    true,
                )
            }
            _ => Err(RpcError::new(METHOD_NOT_FOUND, format!("Method not found: {method}"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{INTERNAL_ERROR, RpcError, contained};

    #[test]
    fn a_panic_while_answering_becomes_an_internal_error_for_that_request() {
        let answered: Result<(), RpcError> = contained("tools/call", || panic!("a compiler bug"));
        let Err(error) = answered else {
            panic!("an error, not a result")
        };
        assert_eq!(error.code, INTERNAL_ERROR);
        assert_eq!(error.message, "Internal error while answering tools/call");
        // The next request is answered as usual.
        assert_eq!(contained("ping", || Ok(1)).ok(), Some(1));
    }
}
