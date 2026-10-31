//! One `zero sync` run (design §5.4): for every synced collection, references first, read the files,
//! the site and the bases, plan each uid, apply, and record the new bases.

use crate::sync::base::Bases;
use crate::sync::client::{Client, Problem};
use crate::sync::conflict::{self, Side};
use crate::sync::front_matter;
use crate::sync::plan::{self, Action, Item, Remote};
use crate::sync::{Report, uid_mint, write_atomic, yaml_out};
use indexmap::IndexMap;
use serde_json::{Map, Value, json};
use std::path::{Path, PathBuf};

pub struct Options {
    pub only: Option<Vec<String>>,
    /// Plan only: write nothing to either side.
    pub check: bool,
}

/// A synced collection, as `/_schema` describes it.
struct Collection {
    name: String,
    dir: PathBuf,
    format: String,
    slug: Option<String>,
    /// Columns a record's `fields` carries, in schema order.
    fields: Vec<String>,
    references: Vec<String>,
}

/// Collections that sync, targets of references first (a cycle keeps config order).
fn collections(schema: &Value, project: &Path, only: &Option<Vec<String>>) -> Result<Vec<Collection>, String> {
    let all = schema["collections"]
        .as_object()
        .ok_or("the site's /_schema has no collections")?;
    let mut synced: IndexMap<String, Collection> = IndexMap::new();
    for (name, spec) in all {
        let Some(sync) = spec["sync"].as_object() else { continue };
        if only.as_ref().is_some_and(|o| !o.contains(name)) {
            continue;
        }
        let content = spec["content"].as_str();
        let pk = spec["primaryKey"].as_str().unwrap_or("id");
        let columns = spec["columns"].as_object().cloned().unwrap_or_default();
        let fields = columns
            .iter()
            .filter(|(c, def)| {
                *c != pk
                    && Some(c.as_str()) != content
                    && *c != "uid"
                    && def.get("onUpdate").is_none()
                    && def["hidden"] != true
                    && (def["derived"] != true || (*c == "translations" && spec["localized"] == true))
            })
            .map(|(c, _)| c.clone())
            .collect();
        let references = columns
            .values()
            .filter_map(|def| def["references"]["collection"].as_str().map(String::from))
            .filter(|target| target != name)
            .collect();
        synced.insert(
            name.clone(),
            Collection {
                name: name.clone(),
                dir: project.join(sync["dir"].as_str().unwrap_or(name)),
                format: sync["format"].as_str().unwrap_or("md").into(),
                slug: spec["slug"].as_str().map(String::from),
                fields,
                references,
            },
        );
    }
    if let Some(unknown) = only.iter().flatten().find(|o| !synced.contains_key(*o)) {
        return Err(format!("--only {unknown}: no such synced collection"));
    }
    let mut ordered: Vec<Collection> = Vec::new();
    let mut pending: Vec<String> = synced.keys().cloned().collect();
    while !pending.is_empty() {
        let ready = pending
            .iter()
            .position(|n| synced[n].references.iter().all(|r| !pending.contains(r) || r == n))
            .unwrap_or(0);
        let name = pending.remove(ready);
        ordered.push(synced.shift_remove(&name).expect("pending"));
    }
    Ok(ordered)
}

/// A file read from a sync directory.
struct File {
    path: PathBuf,
    item: Item,
}

/// Every record file of a collection by uid; files without a uid get one written in first.
fn read_files(c: &Collection, report: &mut Report, check: bool) -> (IndexMap<String, File>, bool) {
    let mut out = IndexMap::new();
    let mut clean = true;
    let Ok(entries) = std::fs::read_dir(&c.dir) else {
        return (out, true);
    };
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some(c.format.as_str()))
        .collect();
    paths.sort();
    for path in paths {
        let rel = report.rel(&path);
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(e) => {
                report.fail(format!("{rel}: {e}"));
                clean = false;
                continue;
            }
        };
        let parsed = if c.format == "json" {
            json_record(&text)
        } else {
            md_record(&text)
        };
        let (mut front, body) = match parsed {
            Ok(p) => p,
            Err((line, message)) => {
                report.fail(format!("{rel}:{line}: {message}"));
                clean = false;
                continue;
            }
        };
        let uid = match front.shift_remove("uid") {
            Some(Value::String(u)) if valid_uid(&u) => u,
            None if !check => {
                let uid = uid_mint();
                let text = render(c, &uid, &front, body.as_deref());
                if let Err(e) = write_atomic(&path, text.as_bytes()) {
                    report.fail(format!("{rel}: {e}"));
                    clean = false;
                    continue;
                }
                report.written(&path);
                uid
            }
            None => {
                report.note(format!("{rel}: has no uid yet; zero sync will give it one"));
                continue;
            }
            Some(_) => {
                report.fail(format!(
                    "{rel}: uid must be zr_ followed by 20 lowercase hex characters"
                ));
                clean = false;
                continue;
            }
        };
        if let Some(other) = out.get(&uid) {
            let other: &File = other;
            report.fail(format!("{rel}: uid {uid} is also in {}", report.rel(&other.path)));
            clean = false;
            continue;
        }
        let record = json!({"uid": uid, "fields": front, "body": body});
        out.insert(
            uid,
            File {
                path,
                item: Item::new(record),
            },
        );
    }
    (out, clean)
}

fn valid_uid(u: &str) -> bool {
    u.len() == 23 && u.starts_with("zr_") && u[3..].bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

type Parsed = Result<(Map<String, Value>, Option<String>), (usize, String)>;

fn md_record(text: &str) -> Parsed {
    let doc = front_matter::parse_document(text).map_err(|e| (e.line, e.message))?;
    Ok((doc.front, (!doc.body.is_empty()).then_some(doc.body)))
}

fn json_record(text: &str) -> Parsed {
    let value: Value = serde_json::from_str(text).map_err(|e| (e.line(), e.to_string()))?;
    let Value::Object(mut map) = value else {
        return Err((1, "a sync file holds one JSON object".into()));
    };
    let body = match map.shift_remove("body") {
        Some(Value::String(s)) if !s.is_empty() => Some(s),
        None | Some(Value::Null) | Some(Value::String(_)) => None,
        Some(_) => return Err((1, "body must be a string or null".into())),
    };
    Ok((map, body))
}

/// The file for a record, its fields in the collection's order.
fn render(c: &Collection, uid: &str, fields: &Map<String, Value>, body: Option<&str>) -> String {
    let mut ordered = Map::new();
    for name in &c.fields {
        if let Some(v) = fields.get(name) {
            ordered.insert(name.clone(), v.clone());
        }
    }
    for (k, v) in fields {
        if !ordered.contains_key(k) {
            ordered.insert(k.clone(), v.clone());
        }
    }
    if c.format == "json" {
        let mut out = Map::new();
        out.insert("uid".into(), Value::String(uid.into()));
        out.extend(ordered);
        out.insert("body".into(), body.map_or(Value::Null, |b| Value::String(b.into())));
        serde_json::to_string_pretty(&Value::Object(out)).expect("serializable") + "\n"
    } else {
        yaml_out::markdown(uid, &ordered, body)
    }
}

/// `<slug>.md` when the collection has a slug and the record a usable one, else `<uid>.md`.
fn file_name(c: &Collection, record: &Value) -> String {
    let slug = c.slug.as_ref().and_then(|s| record["fields"][s].as_str()).filter(|s| {
        !s.is_empty() && !s.starts_with('.') && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    });
    format!(
        "{}.{}",
        slug.unwrap_or(record["uid"].as_str().unwrap_or("record")),
        c.format
    )
}

/// The site's records of a collection, all pages.
fn pull(client: &Client, c: &Collection) -> Result<IndexMap<String, Remote>, Problem> {
    let mut out = IndexMap::new();
    let mut after: i64 = 0;
    loop {
        let page = client.get(&format!("/sync/{}?after={after}&first=100", c.name))?;
        for item in page["records"].as_array().into_iter().flatten() {
            let uid = item["uid"]
                .as_str()
                .or(item["record"]["uid"].as_str())
                .unwrap_or_default()
                .to_string();
            let remote = if item["trashed"] == true {
                Remote::Gone
            } else if let Some(refused) = item["refused"].as_str() {
                Remote::Refused(item["message"].as_str().unwrap_or(refused).to_string())
            } else {
                Remote::Live(Item {
                    record: item["record"].clone(),
                    digest: item["digest"].as_str().unwrap_or_default().into(),
                })
            };
            out.insert(uid, remote);
        }
        match page["next"].as_i64() {
            Some(n) => after = n,
            None => return Ok(out),
        }
    }
}

pub fn run(project: &Path, client: &Client, options: &Options, report: &mut Report) -> Result<(), String> {
    let schema = client
        .get("/_schema")
        .map_err(|p| format!("could not read the site's schema: {}", p.message()))?;
    let site = schema["site"]["id"]
        .as_str()
        .ok_or("the site's /_schema has no site id; is it running zero 0.2?")?
        .to_string();
    let label = if schema["target"] == "wp" { "wordpress" } else { "site" };
    let mut bases = Bases::load(project)?;
    let known = bases.knows_site(&site);
    if !known {
        report.note("first sync with this site: records are matched, nothing is deleted".into());
    }
    for c in collections(&schema, project, &options.only)? {
        collection(client, &c, &site, label, known, &mut bases, options, report)?;
    }
    if !options.check {
        bases.touch(&site);
        bases.save()?;
        report.written(bases.path());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn collection(
    client: &Client,
    c: &Collection,
    site: &str,
    label: &str,
    known: bool,
    bases: &mut Bases,
    options: &Options,
    report: &mut Report,
) -> Result<(), String> {
    let (files, clean) = read_files(c, report, options.check);
    let mut remote = pull(client, c).map_err(|p| format!("{}: {}", c.name, p.message()))?;
    let base_entries = bases.collection(site, &c.name);
    let mut uids: Vec<String> = files.keys().cloned().collect();
    for uid in remote.keys().chain(base_entries.keys()) {
        if !uids.contains(uid) {
            uids.push(uid.clone());
        }
    }
    // Bodies both sides changed are merged on the server, in batches.
    let mut merges: Vec<(String, plan::BodyMerge)> = Vec::new();
    let base_of = |uid: &str| {
        base_entries.get(uid).map(|b| Item {
            record: b["record"].clone(),
            digest: b["digest"].as_str().unwrap_or_default().into(),
        })
    };
    for uid in &uids {
        let r = remote.get(uid).cloned().unwrap_or(Remote::Gone);
        if let Some(m) = plan::body_merge(files.get(uid).map(|f| &f.item), &r, base_of(uid).as_ref()) {
            merges.push((uid.clone(), m));
        }
    }
    let mut merged: IndexMap<String, Result<String, ()>> = IndexMap::new();
    for chunk in merges.chunks(100) {
        let records: Vec<Value> = chunk
            .iter()
            .map(|(_, (b, o, t))| json!({"base": b, "ours": o, "theirs": t}))
            .collect();
        let answer = client
            .post(&format!("/sync/{}/merge", c.name), &json!({"records": records}))
            .map_err(|p| format!("{}: {}", c.name, p.message()))?;
        for ((uid, _), result) in chunk.iter().zip(answer["records"].as_array().into_iter().flatten()) {
            merged.insert(uid.clone(), result["merged"].as_str().map(String::from).ok_or(()));
        }
    }
    for uid in &uids {
        let file = files.get(uid);
        let base = base_of(uid);
        let mut r = remote.shift_remove(uid).unwrap_or(Remote::Gone);
        let mut retried = false;
        loop {
            let action = plan::plan(
                file.map(|f| &f.item),
                &r,
                base.as_ref(),
                known && clean,
                merged.get(uid).cloned(),
            );
            match perform(
                client,
                c,
                uid,
                action,
                file,
                base.as_ref(),
                &r,
                site,
                label,
                bases,
                options,
                report,
            ) {
                Ok(()) => break,
                Err(Stale) if !retried => {
                    // Re-plan once against what the site holds now.
                    retried = true;
                    r = pull(client, c)
                        .map_err(|p| format!("{}: {}", c.name, p.message()))?
                        .shift_remove(uid)
                        .unwrap_or(Remote::Gone);
                }
                Err(Stale) => {
                    report.fail(format!("{}/{uid}: the site kept changing; run zero sync again", c.name));
                    break;
                }
            }
        }
    }
    Ok(())
}

struct Stale;

#[allow(clippy::too_many_arguments)]
fn perform(
    client: &Client,
    c: &Collection,
    uid: &str,
    action: Action,
    file: Option<&File>,
    base: Option<&Item>,
    remote: &Remote,
    site: &str,
    label: &str,
    bases: &mut Bases,
    options: &Options,
    report: &mut Report,
) -> Result<(), Stale> {
    let name = &c.name;
    let pending = |report: &mut Report, what: &str| report.pending(format!("{name}/{uid}: {what}"));
    match action {
        Action::Nothing => {}
        Action::Skip(why) => report.note(format!("{name}/{uid}: {why}")),
        Action::Refused(message) => report.refused(message),
        Action::Adopt(item) => {
            if !options.check {
                bases.set(site, name, uid, &item.digest, &item.record);
            }
        }
        Action::Forget => {
            if !options.check {
                bases.remove(site, name, uid);
            }
        }
        Action::Pull(item) => {
            if options.check {
                pending(report, "pull from the site");
                return Ok(());
            }
            if write_record(c, file.map(|f| f.path.as_path()), &item.record, report) {
                bases.set(site, name, uid, &item.digest, &item.record);
                report.applied();
            }
        }
        Action::Push { record, expect } => {
            if options.check {
                pending(report, "push to the site");
                return Ok(());
            }
            match client.post(&format!("/sync/{name}"), &json!({"record": record, "expect": expect})) {
                Ok(answer) => {
                    let stored = answer
                        .get("record")
                        .filter(|r| r.is_object())
                        .cloned()
                        .unwrap_or(record);
                    let digest = answer["digest"].as_str().unwrap_or_default().to_string();
                    let landed = file.is_some_and(|f| f.item.digest == digest)
                        || write_record(c, file.map(|f| f.path.as_path()), &stored, report);
                    if landed {
                        bases.set(site, name, uid, &digest, &stored);
                        report.applied();
                    }
                }
                Err(p) if p.code() == "sync_stale" => return Err(Stale),
                Err(p) => report.fail(format!("{name}/{uid}: {}", p.message())),
            }
        }
        Action::TrashRemote { expect } => {
            if options.check {
                pending(report, "trash on the site (its file was deleted)");
                return Ok(());
            }
            match client.post(&format!("/sync/{name}/trash"), &json!({"uid": uid, "expect": expect})) {
                Ok(_) => {
                    bases.remove(site, name, uid);
                    report.applied();
                }
                Err(p) if p.code() == "sync_stale" => return Err(Stale),
                Err(p) => report.fail(format!("{name}/{uid}: {}", p.message())),
            }
        }
        Action::DeleteFile => {
            if options.check {
                pending(report, "delete the file (trashed on the site)");
                return Ok(());
            }
            let path = &file.expect("a file to delete").path;
            match std::fs::remove_file(path) {
                Ok(()) => {
                    report.written(path);
                    bases.remove(site, name, uid);
                    report.applied();
                }
                Err(e) => report.fail(format!("{}: {e}", report.rel(path))),
            }
        }
        Action::Conflict(pointers) => {
            let theirs = match remote {
                Remote::Live(item) => Some(item),
                _ => None,
            };
            let path = report.project().join(".zero/conflicts").join(format!("{uid}.md"));
            if !options.check {
                let text = conflict::render(conflict::Conflict {
                    uid,
                    pointers: &pointers,
                    local_digest: file.map_or("absent", |f| f.item.digest.as_str()),
                    remote_digest: theirs.map_or("absent", |t| t.digest.as_str()),
                    ours: Side {
                        record: file.map(|f| &f.item.record),
                    },
                    base: Side {
                        record: base.map(|b| &b.record),
                    },
                    theirs: Side {
                        record: theirs.map(|t| &t.record),
                    },
                    site: label,
                });
                if let Err(e) = write_atomic(&path, text.as_bytes()) {
                    report.fail(format!("{}: {e}", report.rel(&path)));
                    return Ok(());
                }
            }
            report.conflict(format!("{name}/{uid}: {} → {}", pointers.join(", "), report.rel(&path)));
        }
    }
    Ok(())
}

/// Write a record's file where it belongs, moving it when its slug changed. True when it landed.
fn write_record(c: &Collection, current: Option<&Path>, record: &Value, report: &mut Report) -> bool {
    let empty = Map::new();
    let uid = record["uid"].as_str().unwrap_or_default();
    let target = c.dir.join(file_name(c, record));
    let text = render(
        c,
        uid,
        record["fields"].as_object().unwrap_or(&empty),
        record["body"].as_str(),
    );
    if target.exists() && current != Some(target.as_path()) {
        report.fail(format!(
            "{}: already holds another record; rename one of them",
            report.rel(&target)
        ));
        return false;
    }
    if let Err(e) = write_atomic(&target, text.as_bytes()) {
        report.fail(format!("{}: {e}", report.rel(&target)));
        return false;
    }
    report.written(&target);
    if let Some(old) = current.filter(|old| *old != target.as_path())
        && std::fs::remove_file(old).is_ok()
    {
        report.written(old);
    }
    true
}

/// `zero sync resolve <uid>`: the edited conflict file becomes the record on both sides.
pub fn resolve(project: &Path, client: &Client, uid: &str, report: &mut Report) -> Result<(), String> {
    let path = project.join(".zero/conflicts").join(format!("{uid}.md"));
    let text = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", report.rel(&path)))?;
    let (files_digest, site_digest) =
        conflict::digests(&text).ok_or("the conflict file's header is missing; rerun zero sync")?;
    let resolved = conflict::resolved(&text)?;
    let schema = client.get("/_schema").map_err(|p| p.message())?;
    let site = schema["site"]["id"]
        .as_str()
        .ok_or("the site's /_schema has no site id")?
        .to_string();
    let mut bases = Bases::load(project)?;
    for c in collections(&schema, project, &None)? {
        let (files, _) = read_files(&c, report, true);
        let remote = pull(client, &c).map_err(|p| p.message())?;
        let in_files = files.get(uid);
        let on_site = remote.get(uid);
        if in_files.is_none() && on_site.is_none() && bases.get(&site, &c.name, uid).is_none() {
            continue;
        }
        let local_now = in_files.map_or("absent".to_string(), |f| f.item.digest.clone());
        let remote_now = match on_site {
            Some(Remote::Live(i)) => i.digest.clone(),
            _ => "absent".into(),
        };
        if local_now != files_digest || remote_now != site_digest {
            return Err(format!(
                "{uid} changed since the conflict was written; run zero sync again to refresh it"
            ));
        }
        let (mut front, body) =
            md_record(&resolved).map_err(|(line, m)| format!("{}:{}: {m}", report.rel(&path), line + 6))?;
        if front.shift_remove("uid").as_ref().and_then(Value::as_str) != Some(uid) {
            return Err("the resolved record must keep its uid".into());
        }
        let record = json!({"uid": uid, "fields": front, "body": body});
        let answer = client
            .post(
                &format!("/sync/{}", c.name),
                &json!({"record": record, "expect": site_digest}),
            )
            .map_err(|p| p.message())?;
        let stored = answer
            .get("record")
            .filter(|r| r.is_object())
            .cloned()
            .unwrap_or(record);
        if !write_record(&c, in_files.map(|f| f.path.as_path()), &stored, report) {
            return Err("the record was applied on the site but its file could not be written".into());
        }
        bases.set(
            &site,
            &c.name,
            uid,
            answer["digest"].as_str().unwrap_or_default(),
            &stored,
        );
        bases.save()?;
        report.written(bases.path());
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        report.written(&path);
        report.applied();
        return Ok(());
    }
    Err(format!("no synced record has uid {uid}"))
}
