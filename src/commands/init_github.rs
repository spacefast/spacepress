//! `first init --github`: `.github/workflows/first-sync.yml`, the GitHub Actions workflow that runs
//! `first sync --pr` (see `docs-site/docs/publishing/content-in-git.mdx`).
//!
//! One job serves both directions, because `first sync --pr` is the two-way sync: a run on a
//! schedule or on the site's `repository_dispatch` brings site edits back as a pull request, and a
//! run on a push to the default branch that touches a synced folder sends those files to the site.
//!
//! The file is the compiler's while its first line is [`HEADER`]: `first init` writes it back when
//! the synced folders change, and `first check` says when it is out of date. Delete that line to
//! keep your own edits; the file is then never touched again.

use std::path::{Path, PathBuf};
use std::process::Command;

pub(super) const HEADER: &str = "# Written by `first init --github`; delete this line to keep your own edits.";
/// The `repository_dispatch` event type the site sends when a synced record is saved.
pub const DISPATCH_EVENT: &str = "first-content-changed";
/// Actions pinned by commit; the comment names the release.
const CHECKOUT: &str = "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0";
const SETUP_NODE: &str = "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6.5.0";

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

/// The project's path below its repository's root; empty at the root or outside git.
fn in_repository(project: &Path) -> String {
    let Some(root) = git(project, &["rev-parse", "--show-toplevel"]).map(PathBuf::from) else {
        return String::new();
    };
    let canonical = |p: &Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    canonical(project)
        .strip_prefix(canonical(&root))
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

/// A YAML double-quoted scalar (JSON's string syntax is one).
fn quoted(s: &str) -> String {
    serde_json::Value::String(s.to_string()).to_string()
}

/// The workflow's path relative to the project, and its text. `dirs` are the synced folders,
/// relative to the project.
pub(super) fn workflow(project: &Path, dirs: &[String]) -> (PathBuf, String) {
    let rel = in_repository(project);
    let in_repo = |p: &str| {
        if rel.is_empty() {
            p.to_string()
        } else {
            format!("{rel}/{p}")
        }
    };
    let mut paths: Vec<String> = dirs
        .iter()
        .map(|d| {
            if d == "." {
                in_repo("**")
            } else {
                in_repo(&format!("{d}/**"))
            }
        })
        .collect();
    paths.sort();
    paths.dedup();
    let install = if project.join("package-lock.json").is_file() {
        "npm ci"
    } else {
        "npm install --no-audit --no-fund"
    };
    let working = if rel.is_empty() {
        String::new()
    } else {
        format!(
            "    defaults:\n      run:\n        working-directory: {}\n",
            quoted(&rel)
        )
    };
    // No kind syncs yet: nothing in git goes to the site, so pushes start no run.
    let mut push = String::new();
    if !paths.is_empty() {
        push.push_str("  push:\n    paths:\n");
        for p in &paths {
            push.push_str(&format!("      - {}\n", quoted(p)));
        }
    }
    let text = format!(
        "{HEADER}
#
# Content in git (https://github.com/spacefast/zero/blob/main/docs-site/docs/publishing/content-in-git.mdx):
# on a schedule and when the site reports a saved record ({DISPATCH_EVENT}), the site's edits come
# back as one pull request; on a push to the default branch that changes synced files, those files go
# to the site. Both are `first sync --pr`.
#
# Settings > Secrets and variables > Actions:
#   variable FIRST_SITE_URL       the site's URL
#   secret   FIRST_APP_PASSWORD   user:application-password of a user who may update the synced kinds
#                                 (first identity agent add <user> --name=sync --write); or FIRST_TOKEN
name: First content sync

on:
  schedule:
    - cron: \"17 * * * *\"
  repository_dispatch:
    types: [{DISPATCH_EVENT}]
  workflow_dispatch:
{push}
permissions:
  contents: write
  pull-requests: write

concurrency:
  group: first-sync
  cancel-in-progress: false

jobs:
  sync:
    # Pushes count only on the default branch: that is the branch the site's content comes from.
    if: github.event_name != 'push' || github.ref_name == github.event.repository.default_branch
    runs-on: ubuntu-24.04
    timeout-minutes: 30
{working}    steps:
      - uses: {CHECKOUT}
        with:
          fetch-depth: 0
      - uses: {SETUP_NODE}
        with:
          node-version: \"22\"
      - run: {install}
      - name: first sync --pr
        env:
          FIRST_SITE_URL: ${{{{ vars.FIRST_SITE_URL }}}}
          FIRST_APP_PASSWORD: ${{{{ secrets.FIRST_APP_PASSWORD }}}}
          FIRST_TOKEN: ${{{{ secrets.FIRST_TOKEN }}}}
          GITHUB_TOKEN: ${{{{ secrets.GITHUB_TOKEN }}}}
        run: npx --no-install first sync --pr --site \"$FIRST_SITE_URL\"
"
    );
    // From the project up to the repository's root, where GitHub reads workflows.
    let up = rel
        .split('/')
        .filter(|s| !s.is_empty())
        .fold(PathBuf::new(), |p, _| p.join(".."));
    (up.join(".github/workflows/first-sync.yml"), text)
}

/// Whether the project's repository has the workflow `first init --github` wrote, unedited.
pub(super) fn written(project: &Path) -> bool {
    let (path, _) = workflow(project, &[]);
    std::fs::read_to_string(project.join(path)).is_ok_and(|text| text.lines().next() == Some(HEADER))
}

/// Whether `first init` may write the workflow: asked for, or already there and still ours.
pub(super) fn managed(current: Option<&str>, asked: bool) -> bool {
    match current {
        None => asked,
        Some(text) => text.lines().next() == Some(HEADER),
    }
}
