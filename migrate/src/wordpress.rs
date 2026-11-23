use std::collections::BTreeMap;
use std::process::{Command, ExitCode};

const USAGE: &str = "usage: spacepress-migrate --from zero wordpress <content|users|spacefast|tables> [options] [--path=<WordPress dir>] [--url=<site>]
  content <content-model.php | -> [--space=<id>] [--apply]
  users --space=<id> [--apply]
  spacefast --space=<id> --source-prefix=<prefix> --target-prefix=<prefix> [--apply | --verify]
  tables <table-import.json> [--apply]";

pub fn cli(args: &[String]) -> ExitCode {
    let Some((operation, rest)) = args.split_first() else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };
    if !matches!(operation.as_str(), "content" | "users" | "spacefast" | "tables") {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    }
    match run(operation, rest) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("{error}\n{USAGE}");
            ExitCode::from(2)
        }
    }
}

fn run(operation: &str, args: &[String]) -> Result<ExitCode, String> {
    let mut positionals = Vec::new();
    let mut flags = BTreeMap::new();
    let mut wp_options = BTreeMap::new();
    for arg in args {
        if let Some(flag) = arg.strip_prefix("--") {
            let (key, value) = match flag.split_once('=') {
                Some((key, value)) if !value.is_empty() => (key, serde_json::Value::String(value.to_owned())),
                Some(_) => return Err(format!("empty value for {arg}")),
                None => (flag, true.into()),
            };
            let options = if matches!(key, "path" | "url") {
                if !value.is_string() {
                    return Err(format!("{arg} needs a value"));
                }
                &mut wp_options
            } else {
                &mut flags
            };
            if options.insert(key, value).is_some() {
                return Err(format!("repeated flag {arg}"));
            }
        } else if arg.starts_with('-') && arg != "-" {
            return Err(format!("unknown flag {arg}"));
        } else {
            positionals.push(arg);
        }
    }
    let stage = tempfile::tempdir().map_err(|e| e.to_string())?;
    macro_rules! stage {
        ($($file:literal),+) => {
            $(std::fs::write(stage.path().join($file), include_str!(concat!("../zero/wp/", $file))).map_err(|e| e.to_string())?;)+
        };
    }
    stage!(
        "entry.php",
        "bootstrap.php",
        "import-tables.php",
        "DryRun.php",
        "Model.php",
        "Migrate.php",
        "Users.php",
        "Spacefast.php",
        "Module.php"
    );
    let mut command = Command::new("wp");
    for (key, value) in wp_options {
        command.arg(format!("--{key}={}", value.as_str().expect("validated string")));
    }
    let status = command
        .arg("eval-file")
        .arg(stage.path().join("entry.php"))
        .arg(serde_json::json!([operation, positionals, flags]).to_string())
        .status()
        .map_err(|e| format!("cannot run WP-CLI: {e}"))?;
    Ok(status
        .code()
        .and_then(|code| u8::try_from(code).ok())
        .map_or(ExitCode::FAILURE, ExitCode::from))
}
