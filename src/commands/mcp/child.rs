//! The commands the server runs for a tool: `first find` and the other site commands, Studio's
//! status, and the compiler in a process of its own. Each is bounded by the server's timeout and
//! stops when the client cancels the request it belongs to.

use super::Options;
use std::io::Read as _;
use std::process::{Command, Output, Stdio};
use std::sync::mpsc;
use std::time::Duration;

/// After a stop, how long the command's pipes get to close before its output is given up on.
const AFTER_STOP: Duration = Duration::from_secs(5);

pub(super) enum Ran {
    Finished(Output),
    /// Stopped at the timeout.
    TimedOut,
    /// Stopped because the client cancelled the request; whatever is answered is not sent.
    Cancelled,
    Failed(std::io::Error),
}

/// Stops a command and everything it started: it leads a process group of its own.
pub(super) fn stop(pid: u32) {
    let mut command = if cfg!(unix) {
        let mut command = Command::new("/bin/sh");
        // A negative number is the process group. No `--` before it: dash's builtin reads that
        // as the number itself.
        command.args(["-c", "kill -TERM \"-$1\"", "sh", &pid.to_string()]);
        command
    } else {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T", "/F"]);
        command
    };
    let _ = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// Runs `command` with no input and its output captured.
pub(super) fn run(options: &Options, mut command: Command) -> Ran {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut command, 0);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => return Ran::Failed(error),
    };
    let pid = child.id();
    {
        let mut flight = options.flight.lock().expect("flight");
        flight.child = Some(pid);
        // The cancellation arrived before the command started.
        if flight.stop {
            stop(pid);
        }
    }
    // Both pipes are read off this thread: a full pipe never blocks the command, and the wait
    // below can end at the timeout.
    let (send, receive) = mpsc::channel();
    let (mut out, mut err) = (child.stdout.take().expect("piped"), child.stderr.take().expect("piped"));
    std::thread::spawn(move || {
        let errors = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = err.read_to_end(&mut bytes);
            bytes
        });
        let mut bytes = Vec::new();
        let _ = out.read_to_end(&mut bytes);
        let _ = send.send((bytes, errors.join().unwrap_or_default()));
    });
    let (timed_out, output) = match receive.recv_timeout(options.timeout) {
        Ok(output) => (false, Some(output)),
        Err(_) => {
            stop(pid);
            (true, receive.recv_timeout(AFTER_STOP).ok())
        }
    };
    // From here the reader thread no longer sees the command, so a later cancellation cannot reach
    // a process that took its number. It is not reaped yet, so the number is still its own.
    let cancelled = {
        let mut flight = options.flight.lock().expect("flight");
        flight.child = None;
        flight.stop
    };
    if output.is_none() {
        let _ = child.kill();
    }
    let status = child.wait();
    match (cancelled, timed_out, output, status) {
        (true, ..) => Ran::Cancelled,
        (_, true, ..) => Ran::TimedOut,
        (_, _, Some((stdout, stderr)), Ok(status)) => Ran::Finished(Output { status, stdout, stderr }),
        (_, _, _, Err(error)) => Ran::Failed(error),
        (_, _, None, Ok(_)) => Ran::TimedOut,
    }
}
