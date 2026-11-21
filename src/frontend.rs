//! Run the optional site asset build on the author machine before compilation or capture.
use crate::diag::{Diag, Result, Span};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

/// Keep this lock alive until the caller finishes consuming the generated assets.
pub(crate) fn prepare_styles(project: &Path) -> Result<Option<File>> {
    let error = |message: String| Diag::new(Span::NONE, message).code(crate::diag::Code::Import);
    if !project.join("typedpress.config.ts").is_file() {
        return Ok(None);
    }
    if !crate::loader::frontend_enabled(&crate::loader::Disk, project)? {
        return Ok(None);
    }
    let guard = (|| -> std::io::Result<File> {
        let state = project.join(".tp");
        std::fs::create_dir_all(&state)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(state.join("frontend.lock"))?;
        lock.try_lock().map_err(std::io::Error::other)?;
        Ok(lock)
    })()
    .map_err(|e| error(format!("can't lock frontend assets for this build: {e}")))?;
    let styles = crate::loader::stylesheet_inputs(project)?;
    if styles.is_empty() && !project.join(crate::loader::FRONTEND_STYLES).is_file() {
        return Ok(None);
    }

    let input = serde_json::to_vec(&styles).expect("paths are strings");
    let mut child = Command::new("node")
        .current_dir(project)
        .args([
            "--input-type=module",
            "--eval",
            r#"
import { readFileSync } from 'node:fs';
import { buildStyles } from '@typedpress/frontend';
await buildStyles({ root: process.cwd(), styles: JSON.parse(readFileSync(0, 'utf8')) });
"#,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| error(format!("can't start the frontend build with Node.js: {e}")))?;
    let write = child.stdin.take().expect("stdin is piped").write_all(&input);
    let status = child
        .wait()
        .map_err(|e| error(format!("can't wait for the frontend build: {e}")))?;
    if !status.success() {
        return Err(error(format!("frontend build failed ({status})"))
            .help("Install the project's dependencies, including @typedpress/frontend and tailwindcss, and check the output above."));
    }
    write.map_err(|e| error(format!("can't send stylesheet imports to the frontend build: {e}")))?;
    Ok(Some(guard))
}
