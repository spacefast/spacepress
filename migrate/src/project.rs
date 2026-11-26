use crate::config::{Failure, fail};
use spacepress::{diag, loader, pipeline, wasm};
use std::collections::BTreeMap;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::rc::Rc;

pub fn check(files: &BTreeMap<PathBuf, String>) -> Result<pipeline::Built, Failure> {
    let root = Path::new("/candidate");
    let memory = wasm::Memory::new(
        files
            .iter()
            .map(|(path, text)| (root.join(path), text.clone()))
            .collect(),
    );
    let diagnostic = |d: diag::Diag| fail("", diag::render(&d, root)).spanned(d.span, root);
    let program = loader::load_from(Rc::new(memory), &root.join("spacepress.config.ts"))
        .map_err(|mut errors| diagnostic(errors.remove(0)))?;
    pipeline::build(root, &program, || Ok(pipeline::Previous::none()), |_| None).map_err(diagnostic)
}

pub fn unused_output(out: &Path) -> Result<(), Failure> {
    match std::fs::symlink_metadata(out) {
        Ok(_) => Err(fail("", "output already exists; choose a new directory")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(fail("", error.to_string())),
    }
}

pub fn write(out: &Path, files: &BTreeMap<String, impl AsRef<[u8]>>) -> Result<(), Failure> {
    let report = |error: io::Error| fail("", error.to_string());
    if let Some(parent) = out.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(report)?;
    }
    std::fs::create_dir(out).map_err(report)?;
    let result = (|| {
        for (path, bytes) in files {
            let target = out.join(path);
            std::fs::create_dir_all(target.parent().expect("file parent")).map_err(report)?;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(target)
                .map_err(report)?;
            file.write_all(bytes.as_ref()).map_err(report)?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(out);
    }
    result
}
