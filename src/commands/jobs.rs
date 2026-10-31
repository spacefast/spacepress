use crate::Args;
use std::{path::Path, process::ExitCode};

/// `zero jobs list|run|retry|cancel|work ...` → `php .zero/app/zero/bin/zero.php jobs ...` (§6.1).
pub(super) fn run(args: &Args, project: &Path) -> ExitCode {
    let script = project.join(".zero/app/zero/bin/zero.php");
    if !script.is_file() {
        eprintln!(
            "error: no standalone build in {}; run `zero build` first (on WordPress use `wp zero jobs`)",
            project.display()
        );
        return ExitCode::from(1);
    }
    match std::process::Command::new("php")
        .arg(&script)
        .arg("jobs")
        .args(&args.rest)
        .status()
    {
        Ok(s) => ExitCode::from(s.code().unwrap_or(1).clamp(0, 255) as u8),
        Err(e) => {
            eprintln!("error: couldn't run php: {e}");
            ExitCode::from(1)
        }
    }
}

/// `zero dev` runs the standalone worker next to the server; it idles at one poll per second.
pub(super) fn worker(out: &Path) -> Option<std::process::Child> {
    match std::process::Command::new("php")
        .arg(out.join("zero/bin/zero.php"))
        .args(["jobs", "work"])
        .stdout(std::process::Stdio::null())
        .spawn()
    {
        Ok(child) => {
            println!("jobs worker running (zero jobs list to inspect)");
            Some(child)
        }
        Err(e) => {
            eprintln!("warning: couldn't start the jobs worker: {e}");
            None
        }
    }
}
