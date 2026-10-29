use crate::{Args, platform, wp_plugins::version};
use serde_json::{Value, json};
use std::{
    path::Path,
    process::{Command, ExitCode},
    time::Duration,
};

fn check(checks: &mut Vec<Value>, name: &str, ok: bool, detail: impl Into<String>) {
    checks.push(json!({"name":name,"ok":ok,"detail":detail.into()}));
}

pub(super) fn run(args: &Args) -> ExitCode {
    let project = args.project.canonicalize().unwrap_or(args.project.clone());
    let wp = args.wp
        || args.target.map_or_else(
            || {
                args.out
                    .clone()
                    .unwrap_or_else(|| project.join(".zero/wp-content"))
                    .join("zero-manifest.json")
                    .is_file()
            },
            |target| target == crate::schema::Target::Wp,
        );
    let out = args
        .out
        .clone()
        .unwrap_or_else(|| project.join(if wp { ".zero/wp-content" } else { ".zero/app" }));
    let mut checks = Vec::new();
    let mut manifest = Value::Null;
    check(
        &mut checks,
        "binary/runtime series",
        env!("CARGO_PKG_VERSION").starts_with(&format!("{}.", platform::SERIES)),
        platform::SERIES,
    );
    if wp {
        match std::fs::read(out.join("zero-manifest.json"))
            .and_then(|bytes| serde_json::from_slice(&bytes).map_err(std::io::Error::other))
        {
            Ok(value) => {
                manifest = value;
                let series = manifest["runtime"].as_str().unwrap_or("missing");
                check(&mut checks, "built runtime series", series == platform::SERIES, series);
                for slug in [
                    "zero-runtime".to_string(),
                    format!("zero-app-{}", manifest["app"].as_str().unwrap_or("")),
                ] {
                    check(
                        &mut checks,
                        &slug,
                        out.join("plugins").join(&slug).is_dir(),
                        "built plugin",
                    );
                }
                check(
                    &mut checks,
                    "identity bundle",
                    out.join("plugins/zero-identity/zero-identity.php").is_file(),
                    "optional identity plugin; runtime availability is reported by the site",
                );
            }
            Err(error) => check(
                &mut checks,
                "wp-content artifact",
                false,
                format!("{error}; run zero build --target wp"),
            ),
        }
    } else {
        local(&out, &mut checks);
    }
    if let Some(site) = &args.site
        && let Err(error) = remote(site, args.token.as_deref(), wp, &manifest, &mut checks)
    {
        check(&mut checks, "site", false, error);
    }
    let ok = checks.iter().all(|check| check["ok"] == true);
    if args.json {
        println!(
            "{}",
            json!({"data":{"ok":ok,"checks":checks,"requirements":platform::requirements()}})
        );
    } else {
        for item in checks {
            println!(
                "{} {}: {}",
                if item["ok"] == true { "✓" } else { "✗" },
                item["name"].as_str().unwrap(),
                item["detail"].as_str().unwrap()
            );
        }
    }
    if ok { ExitCode::SUCCESS } else { ExitCode::from(1) }
}

fn local(out: &Path, checks: &mut Vec<Value>) {
    let script = r#"
$root = $argv[1];
$schema = is_file($root . '/zero/app/schema.php') ? require $root . '/zero/app/schema.php' : [];
$database = getenv('ZERO_DB_PATH') ?: $root . '/data/zero.sqlite';
$pending = [];
$applied = [];
if (extension_loaded('pdo_sqlite') && is_file($database)) {
    $db = new PDO('sqlite:' . $database, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    if ($db->query("SELECT name FROM sqlite_master WHERE type='table' AND name='__zero_migrations'")->fetchColumn()) {
        $applied = $db->query('SELECT id FROM __zero_migrations')->fetchAll(PDO::FETCH_COLUMN);
    }
}
foreach (glob($root . '/zero/app/migrations/*.sql') ?: [] as $file) {
    if (!in_array(basename($file, '.sql'), $applied, true)) {
        $pending[] = basename($file);
    }
}
echo json_encode(['php' => PHP_VERSION, 'extensions' => get_loaded_extensions(),
    'runtime' => $schema['runtime'] ?? null, 'identity' => ($schema['auth']['collection'] ?? null) !== null,
    'migrations' => $pending]);
"#;
    let result = Command::new("php").args(["-r", script]).arg(out).output();
    match result {
        Ok(output) if output.status.success() => {
            if let Ok(info) = serde_json::from_slice::<Value>(&output.stdout) {
                let php = info["php"].as_str().unwrap_or("0");
                check(checks, "PHP", version::at_least(php, platform::PHP), php);
                let extensions = info["extensions"].as_array().cloned().unwrap_or_default();
                let mut required = vec!["pdo_sqlite", "gd"];
                if info["identity"] == true {
                    required.push("sodium");
                }
                for extension in required {
                    check(
                        checks,
                        extension,
                        extensions.iter().any(|name| name == extension),
                        "PHP extension",
                    );
                }
                let series = info["runtime"].as_str().unwrap_or("missing");
                check(checks, "built runtime series", series == platform::SERIES, series);
                let pending = info["migrations"].as_array().cloned().unwrap_or_default();
                check(
                    checks,
                    "pending migrations",
                    pending.is_empty(),
                    format!("{}; run the built app's migrate command", pending.len()),
                );
            } else {
                check(checks, "PHP diagnostics", false, "invalid PHP diagnostic output");
            }
        }
        Ok(output) => check(checks, "PHP", false, String::from_utf8_lossy(&output.stderr).trim()),
        Err(error) => check(checks, "PHP", false, error.to_string()),
    }
    for name in ["data", "private"] {
        let directory = out.join(name);
        check(
            checks,
            &format!("writable {name}"),
            directory.is_dir() && tempfile::NamedTempFile::new_in(&directory).is_ok(),
            directory.display().to_string(),
        );
    }
}

fn remote(site: &str, token: Option<&str>, wp: bool, manifest: &Value, checks: &mut Vec<Value>) -> Result<(), String> {
    let mut url = url::Url::parse(site).map_err(|error| error.to_string())?;
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
        return Err("site must be an HTTP(S) URL without credentials".into());
    }
    let rest_route = url
        .query_pairs()
        .find(|(key, _)| key == "rest_route")
        .map(|(_, value)| value.into_owned());
    if wp && let Some(route) = rest_route {
        let pairs: Vec<_> = url
            .query_pairs()
            .filter(|(key, _)| key != "rest_route")
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect();
        url.query_pairs_mut()
            .clear()
            .extend_pairs(pairs)
            .append_pair("rest_route", &format!("{}/_schema", route.trim_end_matches('/')));
    } else {
        let path = url.path().trim_end_matches('/');
        let path = if path.ends_with("/api") || path.ends_with("/wp-json/zero/v1") {
            format!("{path}/_schema")
        } else {
            format!("{path}{}/_schema", if wp { "/wp-json/zero/v1" } else { "/api" })
        };
        url.set_path(&path);
    }
    url.set_fragment(None);
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(15)))
        .max_redirects(0)
        .build()
        .into();
    let mut request = agent.get(url.as_str());
    if let Some(token) = token {
        request = request.header("Authorization", format!("Bearer {token}"));
    }
    let mut response = request
        .call()
        .map_err(|_| "could not read the site's schema; check its URL and credentials".to_string())?;
    let body = response
        .body_mut()
        .read_to_string()
        .map_err(|_| "could not read site diagnostics".to_string())?;
    let description: Value =
        serde_json::from_str(&body).map_err(|_| "site returned an invalid schema document".to_string())?;
    let runtime = &description["data"]["runtime"];
    let series = runtime["series"].as_str().unwrap_or("missing");
    check(checks, "site runtime series", series == platform::SERIES, series);
    if wp {
        let versions = &runtime["wp"];
        let identity = versions["identity"].as_bool();
        let identity_required = !description["data"]["auth"]["collection"].is_null();
        check(
            checks,
            "identity",
            identity.is_some_and(|available| available || !identity_required),
            if identity == Some(true) {
                "compatible identity active"
            } else if identity_required {
                "configured authentication requires a compatible Zero Identity"
            } else {
                "optional identity inactive"
            },
        );
        for (name, minimum) in [("wordpress", platform::WORDPRESS), ("php", platform::PHP)] {
            let key = if name == "wordpress" { "version" } else { name };
            let found = versions[key].as_str().unwrap_or("inactive");
            check(
                checks,
                name,
                version::at_least(found, minimum),
                format!("{found}; requires {minimum}+"),
            );
        }
        for plugin in platform::plugins(manifest["requires"].get("polylang").is_some()) {
            let key = match plugin.slug.as_str() {
                "secure-custom-fields" => "scf",
                "action-scheduler" => "actionScheduler",
                "mcp-adapter" => "mcpAdapter",
                other => other,
            };
            let found = versions[key].as_str().unwrap_or("inactive");
            check(
                checks,
                &plugin.slug,
                version::at_least(found, &plugin.version),
                format!("{found}; requires {}+", plugin.version),
            );
        }
        let incompatible = versions["incompatibleTables"].as_array();
        check(
            checks,
            "InnoDB/utf8mb4 tables",
            incompatible.is_some_and(Vec::is_empty),
            incompatible.map_or("missing diagnostics".to_string(), |tables| {
                format!("{} incompatible tables", tables.len())
            }),
        );
        if let Some(expected) = manifest["locales"]["all"].as_array() {
            let mut expected = expected.clone();
            expected.sort_by_key(|locale| locale.as_str().unwrap_or("").to_string());
            let mut actual = runtime["languages"].as_array().cloned().unwrap_or_default();
            actual.sort_by_key(|locale| locale.as_str().unwrap_or("").to_string());
            check(
                checks,
                "Polylang languages",
                actual == expected,
                format!("configured {expected:?}; found {actual:?}"),
            );
        }
        if description["data"]["files"]
            .as_object()
            .is_some_and(|files| !files.is_empty())
        {
            check(
                checks,
                "private-file protection",
                runtime["privateFiles"]["protected"] == true,
                "site must report a successful protection probe",
            );
        }
        let database = &versions["database"];
        let found = database["version"].as_str().unwrap_or("0");
        let minimum = if database["kind"] == "mariadb" {
            platform::MARIADB
        } else {
            platform::MYSQL
        };
        check(
            checks,
            "database",
            version::at_least(found, minimum),
            format!("{found}; requires {minimum}+"),
        );
        let pending = runtime["pendingMigrations"].as_array();
        check(
            checks,
            "site pending migrations",
            pending.is_some_and(Vec::is_empty),
            pending.map_or("missing diagnostics".to_string(), |pending| pending.len().to_string()),
        );
    }
    Ok(())
}
