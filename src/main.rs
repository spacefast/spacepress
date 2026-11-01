//! `zero` — compiles `zero.config.ts` into a PHP app (standalone) or a
//! WordPress plugin.
//!
//! ```text
//! zero build [dir] [--target standalone|wp] [--out <dir>] [--quiet]
//! zero check [dir] [--json]             compile; write nothing (JSON diagnostics optional)
//! zero dev [dir] [--port <n>]           build, then serve with `php -S`
//! zero dev [dir] --wp [--port <n>]      build the plugin and boot it in docker WordPress (embedded harness)
//! zero users|tokens <args...> [--dir d] the standalone CLI (zero/bin/zero.php user/token ...)
//! zero jobs <list|run|retry|cancel|work> [--dir d]   the standalone job queue (§6.1)
//! zero sync [status|resolve <uid>] [dir] --site <url> <credential>   files ⇄ records (src/commands/sync.rs)
//! ```

mod builtins;
mod client;
mod commands;
mod compile;
mod config_migrate;
mod diag;
mod eval;
mod extract;
mod ir;
mod loader;
mod lower;
mod migrate;
mod num;
mod platform;
mod schema;
mod schema_php;
mod sync;
mod types;
mod uri;
mod value;
mod wp_plugins;
mod wpml_config;

use schema::Target;
use std::path::PathBuf;
use std::process::ExitCode;

mod runtime_files {
    include!(concat!(env!("OUT_DIR"), "/runtime_files.rs"));
}

struct Args {
    command: String,
    project: PathBuf,
    out: Option<PathBuf>,
    port: u16,
    target: Option<Target>,
    wp: bool,
    quiet: bool,
    rest: Vec<String>,
    site: Option<String>,
    token: Option<String>,
    json: bool,
}

const USAGE: &str = "usage: zero <build|check|dev|doctor> [project-dir] [--target wp] [--out dir] [--port n] [--wp] [--quiet]\n       zero check [project-dir] [--json]\n       zero <users|tokens|jobs> <args...> [--dir project-dir]\n       zero migrate config --from emdash|payload|sanity|zero <input> --out <new/zero.config.ts>\n       zero migrate site <content-model.php> [--dry-run] [--space <id>] [--wp \"<wp-cli command>\"]\n       zero sync [status | resolve <uid>] [dir] --site <url> --token <t> | --app-password <user:pass> | --bearer <jwt>";

fn parse_args() -> Result<Args, String> {
    let mut it = std::env::args().skip(1);
    let command = it.next().ok_or(USAGE)?;
    let mut args = Args {
        command,
        project: PathBuf::from("."),
        out: None,
        port: 8787,
        target: None,
        wp: false,
        quiet: false,
        rest: Vec::new(),
        site: None,
        token: None,
        json: false,
    };
    if args.command == "sync" {
        args.rest = it.collect();
        return Ok(args);
    }
    if matches!(args.command.as_str(), "users" | "tokens" | "user" | "token" | "jobs") {
        while let Some(a) = it.next() {
            if a == "--dir" {
                args.project = PathBuf::from(it.next().ok_or("--dir needs a directory")?);
            } else {
                args.rest.push(a);
            }
        }
        return Ok(args);
    }
    while let Some(a) = it.next() {
        match a.as_str() {
            "--site" => args.site = Some(it.next().ok_or("--site needs a URL")?),
            "--token" => args.token = Some(it.next().ok_or("--token needs a bearer token")?),
            "--json" => args.json = true,
            "--out" => args.out = Some(PathBuf::from(it.next().ok_or("--out needs a directory")?)),
            "--port" => {
                args.port = it
                    .next()
                    .ok_or("--port needs a number")?
                    .parse()
                    .map_err(|_| "--port needs a number")?
            }
            "--target" => {
                let t = it.next().ok_or("--target needs standalone or wp")?;
                args.target = Some(Target::parse(&t).ok_or(format!("unknown target {t}; use standalone or wp"))?);
            }
            "--wp" => args.wp = true,
            "--quiet" | "-q" => args.quiet = true,
            other if other.starts_with("--") => return Err(format!("unknown flag {other}\n{USAGE}")),
            other => args.project = PathBuf::from(other),
        }
    }
    if args.command != "doctor" && (args.site.is_some() || args.token.is_some()) {
        return Err("--site and --token are doctor options".into());
    }
    if args.json && !matches!(args.command.as_str(), "doctor" | "check") {
        return Err("--json is supported by doctor and check".into());
    }
    Ok(args)
}

fn main() -> ExitCode {
    if std::env::args().nth(1).as_deref() == Some("migrate") {
        if std::env::args().nth(2).as_deref() == Some("site") {
            return commands::migrate_site(&std::env::args().skip(3).collect::<Vec<_>>());
        }
        return config_migrate::cli();
    }
    match parse_args() {
        Ok(args) => commands::run(&args),
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(2)
        }
    }
}
