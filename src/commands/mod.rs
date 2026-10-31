mod build;
mod dev;
mod doctor;
mod jobs;
mod migrate_site;
mod sync;
mod users;

pub(crate) use build::validate_config;
pub(crate) use migrate_site::cli as migrate_site;

pub(crate) fn run(args: &crate::Args) -> std::process::ExitCode {
    match args.command.as_str() {
        "doctor" => doctor::run(args),
        "sync" => sync::run(&args.rest),
        "jobs" => jobs::run(args, &args.project.canonicalize().unwrap_or(args.project.clone())),
        "users" | "tokens" | "user" | "token" => {
            let project = args.project.canonicalize().unwrap_or(args.project.clone());
            users::run(args, &project)
        }
        _ => build::run(args),
    }
}
