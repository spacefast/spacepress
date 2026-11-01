//! The compiler core for a browser: sources in memory, every generated text out, as JSON.
//!
//! The site's config builder calls [`compile`] through the exported C ABI (`zero_alloc`,
//! `zero_compile`, `zero_free`) from a `wasm32-unknown-unknown` build of this library with the
//! `cli` feature off: no file system, no network, no embedded runtime. The envelope is the one
//! `zero check --json` prints, so a config that checks here checks on the command line.
//!
//! Request:
//! ```json
//! { "name": "pantry",
//!   "files": { "zero.config.ts": "…", "lib/fields.ts": "…" },
//!   "previous": null, "migrationFiles": [] }
//! ```
//! `previous` is the last build's `zero/migrations/snapshot.json` (null for a first build) and
//! `migrationFiles` the names beside it, which number the next migration like `zero build` does.
//! Directories exist as the parents of files: a project in memory has no empty directory, and git
//! cannot hold one either, so that is the one shape of project the disk can have and this cannot.
//!
//! Response: `{ "check": <zero-diagnostics envelope>, "output": null }` on a diagnostic, otherwise
//! `output` carries `schemaPhp`, `functionsPhp`, `migrations` (`[name, sql]` pairs), `snapshot`,
//! `client` (`types.ts` and `schema.ts`), `genTs`, `warnings` and `hints`.

use crate::loader::{self, Fs};
use crate::{diag, pipeline};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use std::rc::Rc;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    name: String,
    files: BTreeMap<String, String>,
    #[serde(default)]
    previous: Option<serde_json::Value>,
    #[serde(default)]
    migration_files: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    schema_php: String,
    functions_php: String,
    migrations: Vec<(String, String)>,
    snapshot: serde_json::Value,
    client: BTreeMap<String, String>,
    gen_ts: String,
    warnings: Vec<String>,
    hints: Vec<String>,
}

#[derive(Serialize)]
struct Response<'a> {
    check: diag::Envelope<'a>,
    output: Option<Output>,
}

/// Sources by absolute path under one project directory.
pub(crate) struct Memory {
    files: BTreeMap<PathBuf, String>,
}

/// Reads like Linux's ENOENT, so the envelope for a missing file is the command line's.
fn not_found() -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::NotFound, "No such file or directory (os error 2)")
}

impl Memory {
    pub(crate) fn new(files: BTreeMap<PathBuf, String>) -> Self {
        Memory { files }
    }

    /// Plain keys: absolute, no `.` or `..`, as the request's paths are joined.
    pub(crate) fn key(path: &Path) -> PathBuf {
        let mut out = PathBuf::from("/");
        for part in path.components() {
            match part {
                Component::RootDir | Component::Prefix(_) | Component::CurDir => {}
                Component::ParentDir => {
                    out.pop();
                }
                Component::Normal(name) => out.push(name),
            }
        }
        out
    }

    fn file_at(&self, key: &Path) -> bool {
        self.files.contains_key(key)
    }

    fn dir_at(&self, key: &Path) -> bool {
        self.files.keys().any(|file| file.starts_with(key) && file != key)
    }

    /// Walks `path` the way the operating system does: every component but the last must be a
    /// directory that exists, so `./absent/../lib` and `./lib.ts/../lib` are not found even though
    /// they name an existing file once `..` is folded, and a trailing `/` names a directory, so
    /// `data.json/` is nothing. The result may or may not exist.
    fn resolve(&self, path: &Path) -> Option<PathBuf> {
        let text = path.to_str()?;
        let wants_dir = text.ends_with('/') || text.ends_with("/.");
        let mut out = PathBuf::from("/");
        for part in path.components() {
            let step = match part {
                Component::RootDir | Component::Prefix(_) | Component::CurDir => continue,
                Component::ParentDir => None,
                Component::Normal(name) => Some(name),
            };
            if out != Path::new("/") && !self.dir_at(&out) {
                return None;
            }
            match step {
                None => {
                    out.pop();
                }
                Some(name) => out.push(name),
            }
        }
        if wants_dir && !self.dir_at(&out) {
            return None;
        }
        Some(out)
    }
}

impl Fs for Memory {
    fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
        let key = self.resolve(path).ok_or_else(not_found)?;
        if let Some(source) = self.files.get(&key) {
            return Ok(source.clone());
        }
        if self.dir_at(&key) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::IsADirectory,
                "Is a directory (os error 21)",
            ));
        }
        Err(not_found())
    }
    fn is_file(&self, path: &Path) -> bool {
        self.resolve(path).is_some_and(|key| self.file_at(&key))
    }
    fn is_dir(&self, path: &Path) -> bool {
        self.resolve(path).is_some_and(|key| self.dir_at(&key))
    }
    fn exists(&self, path: &Path) -> bool {
        self.resolve(path)
            .is_some_and(|key| self.file_at(&key) || self.dir_at(&key))
    }
    fn canonicalize(&self, path: &Path) -> std::io::Result<PathBuf> {
        let key = self.resolve(path).ok_or_else(not_found)?;
        if self.file_at(&key) || self.dir_at(&key) {
            Ok(key)
        } else {
            Err(not_found())
        }
    }
}

/// One compile of a request (see the module documentation); always answers with JSON.
pub fn compile(request: &str) -> String {
    let request: Request = match serde_json::from_str(request) {
        Ok(request) => request,
        Err(e) => return serde_json::json!({ "error": format!("invalid request: {e}") }).to_string(),
    };
    diag::isolated(|| compile_request(request))
}

fn compile_request(request: Request) -> String {
    let project = PathBuf::from("/").join(&request.name);
    let files = request
        .files
        .into_iter()
        .map(|(rel, source)| (Memory::key(&project.join(rel)), source))
        .collect();
    let previous =
        || pipeline::Previous::from_project(request.previous, request.migration_files.iter().map(String::as_str));
    let entry = project.join("zero.config.ts");
    let built = match loader::load_from(Rc::new(Memory::new(files)), &entry) {
        Err(diagnostics) => Err(diagnostics),
        Ok(program) => pipeline::build(&project, &program, previous, |_| None).map_err(|d| vec![d]),
    };
    let (diagnostics, output) = match built {
        Err(diagnostics) => (diagnostics, None),
        Ok(built) => {
            let client = built
                .client_files
                .into_iter()
                .map(|(name, bytes)| (name, String::from_utf8_lossy(&bytes).into_owned()))
                .collect();
            let output = Output {
                schema_php: crate::schema_php::render(&built.schema),
                functions_php: built.functions_php,
                migrations: built.migrations,
                snapshot: built.snapshot,
                client,
                gen_ts: built.gen_ts,
                warnings: built.warnings,
                hints: built.hints,
            };
            (Vec::new(), Some(output))
        }
    };
    let response = Response {
        check: diag::envelope(&diagnostics, &project),
        output,
    };
    serde_json::to_string(&response).expect("response serializes")
}

/// The C ABI the browser glue uses: a request buffer in, a length-prefixed response buffer out.
#[cfg(target_arch = "wasm32")]
mod abi {
    /// A buffer of `len` bytes for the caller to write the request into.
    #[unsafe(no_mangle)]
    pub extern "C" fn zero_alloc(len: usize) -> *mut u8 {
        let mut buffer = Vec::<u8>::with_capacity(len);
        let ptr = buffer.as_mut_ptr();
        std::mem::forget(buffer);
        ptr
    }

    /// Frees a buffer from `zero_alloc` or `zero_compile` (`len` is the length it was handed out with).
    ///
    /// # Safety
    /// `ptr` and `len` must come from one of those two functions and not have been freed already.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn zero_free(ptr: *mut u8, len: usize) {
        drop(unsafe { Vec::from_raw_parts(ptr, 0, len) });
    }

    /// Compiles the UTF-8 request at `ptr..ptr+len`, taking ownership of that buffer. Returns a buffer
    /// whose first four bytes are the little-endian length of the JSON response that follows; free it
    /// with `zero_free(ptr, 4 + len)`.
    ///
    /// # Safety
    /// `ptr..ptr+len` must be a `zero_alloc(len)` buffer the caller has filled.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn zero_compile(ptr: *mut u8, len: usize) -> *mut u8 {
        let request = unsafe { Vec::from_raw_parts(ptr, len, len) };
        let response = match std::str::from_utf8(&request) {
            Ok(request) => super::compile(request),
            Err(_) => serde_json::json!({ "error": "request is not UTF-8" }).to_string(),
        };
        let mut out = Vec::with_capacity(4 + response.len());
        out.extend_from_slice(&(response.len() as u32).to_le_bytes());
        out.extend_from_slice(response.as_bytes());
        let ptr = out.as_mut_ptr();
        std::mem::forget(out);
        ptr
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory() -> Memory {
        Memory::new(
            [("/p/zero.config.ts", ""), ("/p/lib.ts", ""), ("/p/dir/util.ts", "")]
                .into_iter()
                .map(|(path, source)| (PathBuf::from(path), source.to_string()))
                .collect(),
        )
    }

    #[test]
    fn a_path_through_a_missing_or_file_component_is_not_found_like_on_disk() {
        let fs = memory();
        assert!(!fs.is_file(Path::new("/p/absent/../lib.ts")));
        assert!(!fs.is_file(Path::new("/p/lib.ts/../lib.ts")));
        assert!(fs.canonicalize(Path::new("/p/dir/../lib.ts")).is_ok());
        assert!(fs.is_file(Path::new("/p/./lib.ts")));
    }

    #[test]
    fn reading_a_directory_fails_the_way_the_operating_system_says_it() {
        let fs = memory();
        assert_eq!(
            fs.read_to_string(Path::new("/p/dir")).unwrap_err().to_string(),
            "Is a directory (os error 21)"
        );
        assert_eq!(
            fs.read_to_string(Path::new("/p/none.ts")).unwrap_err().to_string(),
            "No such file or directory (os error 2)"
        );
    }

    #[test]
    fn a_trailing_slash_names_a_directory_so_a_file_with_one_is_nothing() {
        let fs = memory();
        assert!(!fs.is_file(Path::new("/p/lib.ts/")));
        assert!(!fs.exists(Path::new("/p/lib.ts/")));
        assert!(fs.canonicalize(Path::new("/p/lib.ts/")).is_err());
        assert!(fs.is_dir(Path::new("/p/dir/")));
        assert_eq!(fs.canonicalize(Path::new("/p/dir/.")).unwrap(), PathBuf::from("/p/dir"));
    }

    #[test]
    fn directories_are_implied_by_the_files_under_them() {
        let fs = memory();
        assert!(fs.is_dir(Path::new("/p/dir")));
        assert!(fs.exists(Path::new("/p/dir")));
        assert!(!fs.is_file(Path::new("/p/dir")));
        assert!(!fs.is_dir(Path::new("/p/di")));
        assert_eq!(fs.canonicalize(Path::new("/p/dir")).unwrap(), PathBuf::from("/p/dir"));
        assert_eq!(
            fs.canonicalize(Path::new("/p/nothing")).unwrap_err().kind(),
            std::io::ErrorKind::NotFound
        );
    }

    #[test]
    fn a_compile_leaves_the_callers_registered_sources_alone() {
        let before = diag::register_file(Path::new("/outer.ts"), "let x = 1;\n");
        let rendered = || {
            diag::render(
                &diag::Diag::new(
                    diag::Span {
                        file: before,
                        start: 4,
                        end: 5,
                    },
                    "here",
                ),
                Path::new("/"),
            )
        };
        let expected = rendered();
        compile(r#"{"name":"p","files":{"zero.config.ts":"export default 1;"}}"#);
        assert_eq!(rendered(), expected);
    }
}
