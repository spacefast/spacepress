mod build;
mod dev;
mod doctor;
mod users;

pub(crate) use build::validate_config;

pub(crate) fn run(args: &crate::Args) -> std::process::ExitCode {
    match args.command.as_str() {
        "doctor" => doctor::run(args),
        "users" | "tokens" | "user" | "token" => {
            let project = args.project.canonicalize().unwrap_or(args.project.clone());
            users::run(args, &project)
        }
        _ => build::run(args),
    }
}
