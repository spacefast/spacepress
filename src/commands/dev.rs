use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    process::ExitCode,
};
/// The WordPress harness files, embedded so an installed binary carries them (paths under the harness root).
const HARNESS: &[(&str, &str)] = &[
    ("wp/harness.sh", include_str!("../../tests/wp/harness.sh")),
    ("wp/compose.yml", include_str!("../../tests/wp/compose.yml")),
    (
        "wp/mu-plugins/capture-mail.php",
        include_str!("../../tests/wp/mu-plugins/capture-mail.php"),
    ),
    (
        "wp/php/zz-zero-tests.ini",
        include_str!("../../tests/wp/php/zz-zero-tests.ini"),
    ),
    (
        "wp/apache/zz-zero-tests.conf",
        include_str!("../../tests/wp/apache/zz-zero-tests.conf"),
    ),
];

/// The harness's `harness.sh`: `$ZERO_WP_HARNESS/harness.sh` when set (a checkout's `tests/wp`), else
/// the embedded copy, written to `$XDG_CACHE_HOME/zero/wp-harness/<digest>` (or `~/.cache/...`). The
/// directory is named by the files' digest, so binaries with different harnesses never overwrite each
/// other's; the same harness reuses it, with its plugin downloads and stack state, between runs.
pub(super) fn harness() -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("ZERO_WP_HARNESS") {
        let script = PathBuf::from(dir).join("harness.sh");
        return if script.is_file() {
            Ok(script)
        } else {
            Err(format!("ZERO_WP_HARNESS has no harness.sh ({})", script.display()))
        };
    }
    let cache = std::env::var_os("XDG_CACHE_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .filter(|v| !v.is_empty())
                .map(|h| PathBuf::from(h).join(".cache"))
        })
        .ok_or("no cache directory for the WordPress harness: set XDG_CACHE_HOME or HOME (or ZERO_WP_HARNESS)")?;
    let platform = serde_json::to_string_pretty(&crate::platform::requirements()).expect("requirements serialize");
    let files: Vec<(&str, &str)> = HARNESS
        .iter()
        .copied()
        .chain([("fixtures/platform.json", platform.as_str())])
        .collect();
    let mut digest = Sha256::new();
    for (rel, contents) in &files {
        for part in [rel.as_bytes(), contents.as_bytes()] {
            digest.update((part.len() as u64).to_le_bytes());
            digest.update(part);
        }
    }
    let digest: String = digest.finalize()[..8].iter().map(|b| format!("{b:02x}")).collect();
    let root = cache.join("zero/wp-harness").join(digest);
    for (rel, contents) in files {
        let path = root.join(rel);
        if std::fs::read(&path).is_ok_and(|current| current == contents.as_bytes()) {
            continue;
        }
        // Replace, never rewrite in place: bash reads a running script as it goes, and another
        // `harness.sh down` may be running from this directory.
        let dir = path.parent().expect("harness files sit in a directory");
        let written = std::fs::create_dir_all(dir)
            .and_then(|()| tempfile::NamedTempFile::new_in(dir))
            .and_then(|mut tmp| {
                std::io::Write::write_all(&mut tmp, contents.as_bytes())?;
                tmp.persist(&path).map_err(|e| e.error)?;
                Ok(())
            });
        written.map_err(|e| format!("couldn't write the WordPress harness to {}: {e}", path.display()))?;
    }
    Ok(root.join("wp/harness.sh"))
}

/// Boots the WordPress harness (see [`harness`]) with the built wp-content.
pub(super) fn wp(content: &Path, port: u16) -> ExitCode {
    let script = match harness() {
        Ok(script) => script,
        Err(e) => {
            eprintln!("error: `zero dev --wp`: {e}");
            return ExitCode::from(1);
        }
    };
    let status = std::process::Command::new("bash")
        .arg(&script)
        .args(["up", "--wp-content"])
        .arg(content)
        .env("ZERO_WP_PORT", port.to_string())
        .status();
    match status {
        Ok(s) if s.success() => {
            let project = std::env::var("ZERO_WP_PROJECT")
                .map(|p| format!("ZERO_WP_PROJECT={} ", shell_quote(&p)))
                .unwrap_or_default();
            println!(
                "WordPress is up on http://127.0.0.1:{port} (admin / zero-test-admin). Stop it with: {project}bash {} down",
                shell_quote(&script.display().to_string())
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

/// `s` as one POSIX shell word, so a printed command can be pasted whatever the path holds.
fn shell_quote(s: &str) -> String {
    if !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/._-+=:@,".contains(&b))
    {
        return s.to_string();
    }
    format!("'{}'", s.replace('\'', "'\\''"))
}
