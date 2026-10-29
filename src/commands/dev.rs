use std::{
    path::{Path, PathBuf},
    process::ExitCode,
};
pub(super) fn standalone(out: &Path, port: u16) -> ExitCode {
    let addr = format!("127.0.0.1:{port}");
    println!("serving http://{addr}  (Ctrl-C to stop)");
    let _worker = super::jobs::worker(out).map(KillOnDrop);
    let status = std::process::Command::new("php")
        .args(["-S", &addr, "-t"])
        .arg(out.join("public"))
        .arg(out.join("public/index.php"))
        .status();
    match status {
        Ok(s) if s.success() => ExitCode::SUCCESS,
        Ok(_) => ExitCode::from(1),
        Err(e) => {
            eprintln!("error: couldn't start php: {e}");
            ExitCode::from(1)
        }
    }
}

struct KillOnDrop(std::process::Child);
impl Drop for KillOnDrop {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Boots the WordPress harness (tests/wp in the Zero checkout, or ZERO_WP_HARNESS) with the plugin.
pub(super) fn wp(content: &Path, port: u16) -> ExitCode {
    let harness_dir = std::env::var_os("ZERO_WP_HARNESS")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/wp"));
    let (script, args): (PathBuf, Vec<String>) = if harness_dir.join("harness.sh").is_file() {
        (
            harness_dir.join("harness.sh"),
            vec!["up".into(), "--wp-content".into(), content.display().to_string()],
        )
    } else {
        (harness_dir.join("up.sh"), vec![content.display().to_string()])
    };
    if !script.is_file() {
        eprintln!(
            "error: `zero dev --wp` needs the WordPress harness (tests/wp/harness.sh); set ZERO_WP_HARNESS to its directory"
        );
        return ExitCode::from(1);
    }
    let status = std::process::Command::new("bash")
        .arg(&script)
        .args(&args)
        .env("ZERO_WP_PORT", port.to_string())
        .env("ZERO_WP_CONTENT", content)
        .status();
    match status {
        Ok(s) if s.success() => {
            println!(
                "WordPress is up on http://127.0.0.1:{port} (admin / zero-test-admin). Stop it with tests/wp/harness.sh down"
            );
            ExitCode::SUCCESS
        }
        Ok(_) => ExitCode::from(1),
        Err(e) => {
            eprintln!("error: couldn't start the WordPress harness (is docker installed?): {e}");
            ExitCode::from(1)
        }
    }
}
