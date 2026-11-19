use std::process::ExitCode;

mod astro;
mod config;
mod project;
mod wordpress;
mod zero;

const USAGE: &str = "usage: typedpress-migrate --from <zero|astro|emdash|payload|sanity> <operation> [options]
  zero: app, config, wordpress
  astro: app
  emdash, payload, sanity: config";

fn main() -> ExitCode {
    let args: Vec<_> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [] => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
        }
        [help] if help == "--help" || help == "-h" => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        [flag, source, operation, rest @ ..] if flag == "--from" => match (source.as_str(), operation.as_str()) {
            ("astro", "app") => astro::cli(rest),
            ("zero", "app") => zero::cli(rest),
            ("zero", "wordpress") => wordpress::cli(rest),
            (_, "config") if config::Source::parse(source).is_some() => config::cli(source, rest),
            _ => {
                eprintln!("{USAGE}");
                ExitCode::from(2)
            }
        },
        _ => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
        }
    }
}

fn hex(bytes: impl AsRef<[u8]>) -> String {
    use std::fmt::Write;
    bytes.as_ref().iter().fold(String::new(), |mut out, byte| {
        write!(out, "{byte:02x}").expect("writing to a String");
        out
    })
}
