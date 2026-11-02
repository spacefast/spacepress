mod build;
mod dev;
mod doctor;
mod migrate_site;
mod sync;

pub(crate) use build::validate_config;
pub(crate) use migrate_site::cli as migrate_site;

pub(crate) fn run(args: &crate::cli::Args) -> std::process::ExitCode {
    match args.command.as_str() {
        "doctor" => doctor::run(args),
        "sync" => sync::run(&args.rest),
        "dev" => dev::run(args),
        _ => build::run(args),
    }
}
