pub(crate) mod backup;
pub(crate) mod build;
pub(crate) mod deploy;
mod dev;
mod doctor;
mod migrate_site;
pub(crate) mod publish;
pub(crate) mod restore;
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
