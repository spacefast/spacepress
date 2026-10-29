use crate::Args;
use std::{path::Path, process::ExitCode};
/// `zero users ...` / `zero tokens ...` → `php .zero/app/zero/bin/zero.php user|token ...`.
pub(super) fn run(args: &Args, project: &Path) -> ExitCode {
    let script = project.join(".zero/app/zero/bin/zero.php");
    if !script.is_file() {
        eprintln!(
            "error: no standalone build in {}; run `zero build` first",
            project.display()
        );
        return ExitCode::from(1);
    }
    let cmd = if args.command.starts_with("user") {
        "user"
    } else {
        "token"
    };
    let status = std::process::Command::new("php")
        .arg(&script)
        .arg(cmd)
        .args(&args.rest)
        .status();
    match status {
        Ok(s) => ExitCode::from(s.code().unwrap_or(1).clamp(0, 255) as u8),
        Err(e) => {
            eprintln!("error: couldn't run php: {e}");
            ExitCode::from(1)
        }
    }
}
