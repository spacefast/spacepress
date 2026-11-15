use super::{Plan, Plugin, Resource, Result, acquire, archive, invalid};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Dependency {
    pub slug: String,
    pub version: String,
    pub plugin_data: Resource,
    pub sha256: String,
    pub requires: Vec<String>,
    pub tree_sha256: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Lock {
    version: u32,
    plugins: Vec<Dependency>,
}

/// Verified archives for every planned dependency. Nothing is extracted until [`Prepared::install`].
pub struct Prepared {
    archives: Vec<Acquired>,
    previous: BTreeMap<String, Dependency>,
}

struct Acquired {
    plugin: Plugin,
    archive: PathBuf,
    sha256: String,
}

/// The dependencies a build installed. A kept tree stays in the previous output, absent from the
/// stage; the assembler moves everything it did not replace into the stage before publishing.
pub struct Installed {
    dependencies: Vec<Dependency>,
}

impl Prepared {
    /// All resolution must finish before acquisition; all acquisition finishes before publication.
    pub fn acquire(plan: &Plan, lock_path: &Path, cache: &Path) -> Result<Self> {
        Self::acquire_using(plan, lock_path, cache, Resource::url)
    }

    // Separate resource naming from transport so local HTTP fixtures exercise the same locking path.
    fn acquire_using(
        plan: &Plan,
        lock_path: &Path,
        cache: &Path,
        resource_url: impl Fn(&Resource) -> String,
    ) -> Result<Self> {
        let previous = match std::fs::read(lock_path) {
            Ok(bytes) => {
                let lock: Lock = serde_json::from_slice(&bytes)
                    .map_err(|e| invalid(format!("invalid WordPress plugin lock: {e}")))?;
                if lock.version != 1 {
                    return Err(invalid("unsupported WordPress plugin lock version"));
                }
                let mut previous = BTreeMap::new();
                for p in lock.plugins {
                    // Lockfiles are input too; validate identities, versions, hashes and dependency edges.
                    let spec = Plugin {
                        slug: p.slug.clone(),
                        version: p.version.clone(),
                        plugin_data: Some(p.plugin_data.clone()),
                        sha256: Some(p.sha256.clone()),
                        requires: p.requires.clone(),
                    };
                    spec.validate()?;
                    if p.tree_sha256.len() != 64
                        || !p.tree_sha256.bytes().all(|b| b.is_ascii_hexdigit())
                        || previous.insert(p.slug.clone(), p).is_some()
                    {
                        return Err(invalid("invalid or duplicate plugin lock entry"));
                    }
                }
                previous
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(e) => return Err(e),
        };
        let mut archives = Vec::new();
        for plugin in &plan.plugins {
            let locked = previous
                .get(&plugin.slug)
                .filter(|p| p.version == plugin.version && p.plugin_data == plugin.resource());
            if let (Some(authored), Some(locked)) = (&plugin.sha256, locked)
                && authored != &locked.sha256
            {
                return Err(invalid(format!(
                    "plugin {}: authored sha256 conflicts with lock; explicitly remove the old lock entry to repin",
                    plugin.slug
                )));
            }
            let pin = plugin.sha256.as_deref().or_else(|| locked.map(|p| p.sha256.as_str()));
            let (archive, sha256) = acquire(plugin, pin, cache, &resource_url(&plugin.resource()))?;
            archives.push(Acquired {
                plugin: plugin.clone(),
                archive,
                sha256,
            });
        }
        Ok(Self { archives, previous })
    }

    /// Installs every dependency into `stage`, the assembler's private, empty plugins directory.
    ///
    /// `previous` is the published plugins directory, if any. A directory there under a dependency's
    /// slug must be the tree the lock recorded; an unmanaged or locally modified one fails the build.
    /// When `reusable` (the output was written by this Zero version) and the lock entry names the same
    /// archive, that tree is kept in place instead of extracted again. Unrelated directories in
    /// `previous` are left to the assembler, including formerly declared plugins (no implicit uninstall).
    pub fn install(self, previous: Option<&Path>, reusable: bool, stage: &Path) -> Result<Installed> {
        std::fs::create_dir_all(stage)?;
        let existing: Vec<String> = match previous {
            Some(previous) => std::fs::read_dir(previous)?
                .map(|entry| Ok(entry?.file_name().to_string_lossy().into_owned()))
                .collect::<Result<_>>()?,
            None => Vec::new(),
        };
        let mut installed = Installed {
            dependencies: Vec::new(),
        };
        for Acquired { plugin, archive, sha256 } in self.archives {
            let slug = &plugin.slug;
            // Include case collisions even on a case-sensitive build host.
            if existing
                .iter()
                .any(|name| name.eq_ignore_ascii_case(slug) && name != slug)
            {
                return Err(invalid(format!("plugin {slug}: case-colliding output path")));
            }
            let locked = self.previous.get(slug);
            let mut tree_sha256 = None;
            if let Some(dest) = previous.map(|p| p.join(slug))
                && std::fs::symlink_metadata(&dest).is_ok()
            {
                let installed_tree = std::fs::symlink_metadata(&dest)?
                    .is_dir()
                    .then(|| archive::tree_digest(&dest).ok())
                    .flatten();
                let Some(locked) = locked.filter(|p| Some(&p.tree_sha256) == installed_tree.as_ref()) else {
                    return Err(invalid(format!(
                        "plugin {slug}: output collision with unmanaged or locally modified plugin"
                    )));
                };
                let same_archive = locked.version == plugin.version
                    && locked.plugin_data == plugin.resource()
                    && locked.sha256 == sha256
                    && super::patches::tree(&plugin, &sha256).is_none_or(|tree| tree == locked.tree_sha256);
                if reusable && same_archive {
                    tree_sha256 = Some(locked.tree_sha256.clone());
                }
            }
            let tree_sha256 = match tree_sha256 {
                Some(tree) => tree,
                None => {
                    let directory = stage.join(slug);
                    archive::extract(&archive, &directory, &plugin)?;
                    super::patches::apply(&plugin, &sha256, &directory)?;
                    let tree = archive::tree_digest(&directory)?;
                    if super::patches::tree(&plugin, &sha256).is_some_and(|expected| expected != tree) {
                        return Err(invalid(format!("plugin {slug}: patched tree differs from its pin")));
                    }
                    tree
                }
            };
            let mut requires = plugin.requires.clone();
            requires.sort();
            installed.dependencies.push(Dependency {
                slug: slug.clone(),
                version: plugin.version.clone(),
                plugin_data: plugin.resource(),
                sha256,
                requires,
                tree_sha256,
            });
        }
        Ok(installed)
    }
}

impl Installed {
    pub fn dependencies(&self) -> impl Iterator<Item = &Dependency> {
        self.dependencies.iter()
    }

    pub fn lock_bytes(&self) -> Result<Vec<u8>> {
        let mut bytes = serde_json::to_vec_pretty(&Lock {
            version: 1,
            plugins: self.dependencies.clone(),
        })?;
        bytes.push(b'\n');
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn wordpress_org_first_acquisition_records_a_pin_and_reuses_it_offline() {
        let temp = tempfile::tempdir().unwrap();
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        writer
            .start_file("example/example.php", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer
            .write_all(b"<?php\n/*\nPlugin Name: Example\nVersion: 1.0\n*/\n")
            .unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        let expected_sha = crate::wp_plugins::digest(&bytes);
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/example.1.0.zip", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            conn.set_read_timeout(Some(std::time::Duration::from_secs(10))).unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while conn.read(&mut byte).unwrap() != 0 {
                request.push(byte[0]);
                if request.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            write!(
                conn,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                bytes.len()
            )
            .unwrap();
            conn.write_all(&bytes).unwrap();
        });
        let config = crate::wp_plugins::parse(serde_json::json!({"example":"1.0"})).unwrap();
        let plan = crate::wp_plugins::resolve(&config, &[]).unwrap();
        let lock = temp.path().join("plugins.lock.json");
        let cache = temp.path().join("cache");
        let first = Prepared::acquire_using(&plan, &lock, &cache, |_| url.clone()).unwrap();
        server.join().unwrap();
        let stage = temp.path().join("first");
        let installed = first.install(None, true, &stage).unwrap();
        let dependency = installed.dependencies().next().unwrap();
        assert_eq!(dependency.sha256, expected_sha);
        assert_eq!(
            dependency.plugin_data,
            Resource::WordPress {
                slug: "example.1.0.zip".into()
            }
        );
        assert!(stage.join("example/example.php").is_file());
        let bytes = installed.lock_bytes().unwrap();
        std::fs::write(&lock, &bytes).unwrap();
        let second = Prepared::acquire_using(&plan, &lock, &cache, |_| url.clone()).unwrap();
        let again = temp.path().join("second");
        assert_eq!(second.install(None, true, &again).unwrap().lock_bytes().unwrap(), bytes);
        assert_eq!(
            std::fs::read(stage.join("example/example.php")).unwrap(),
            std::fs::read(again.join("example/example.php")).unwrap()
        );
        std::fs::write(cache.join(format!("{expected_sha}.zip")), b"changed bytes").unwrap();
        let failure = Prepared::acquire_using(&plan, &lock, &cache, |_| url.clone());
        assert!(failure.err().unwrap().to_string().contains("corrupt or unsafe cache"));
    }
}
