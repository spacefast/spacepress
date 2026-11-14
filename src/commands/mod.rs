pub(crate) mod abilities;
pub(crate) mod add;
pub(crate) mod build;
pub(crate) mod deploy;
mod describe;
mod dev;
mod doctor;
pub(crate) mod init;
mod init_github;
pub(crate) mod links;
pub(crate) mod mcp;
pub(crate) mod pull;
pub(crate) mod site;
mod sync;

pub(crate) use sync::run as sync;

pub(crate) fn run(args: &crate::cli::Args) -> std::process::ExitCode {
    match args.command.as_str() {
        "doctor" => doctor::run(args),
        "dev" => dev::run(args),
        _ => build::run(args),
    }
}
