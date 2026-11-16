// Differential scenarios. verify.mjs imports this module under Node against the
// installed files-sdk, and app/typedpress.config.ts compiles it to PHP; both outputs
// must be byte-identical JSON. Each scenario returns plain data only.
// `lastModified` depends on the clock, so it is reported as its type.
import { Files, FilesError } from "files-sdk";
import { memory } from "files-sdk/memory";

function info(value) {
  if (value === undefined || value === null) return null;
  return {
    key: value.key,
    size: value.size,
    contentType: value.contentType,
    etag: value.etag,
    lastModified: typeof value.lastModified,
  };
}

function failure(error) {
  return {
    filesError: error instanceof FilesError,
    name: error.name,
    code: error.code,
    message: error.message,
    permanent: error.permanent,
  };
}

async function attempt(operation) {
  try {
    return { ok: await operation() };
  } catch (error) {
    return { error: failure(error) };
  }
}

export async function roundtrip(key, body) {
  const files = new Files({ adapter: memory() });
  const uploaded = await files.upload(key, body, { contentType: "text/plain" });
  const got = await files.download(key);
  return {
    uploaded: info(uploaded),
    exists: await files.exists(key),
    missing: await files.exists(key + ".missing"),
    text: await got.text(),
    downloaded: info(got),
    head: info(await files.head(key)),
  };
}

export async function listing() {
  const files = new Files({ adapter: memory() });
  await files.upload("a/one.txt", "1", { contentType: "text/plain" });
  await files.upload("a/two.txt", "22", { contentType: "text/plain" });
  await files.upload("b/three.json", "{}", { contentType: "application/json" });
  const all = await files.list();
  const prefixed = await files.list({ prefix: "a/" });
  const folders = await files.list({ delimiter: "/" });
  return {
    all: all.items.map(info),
    prefixed: prefixed.items.map((item) => item.key),
    folders: { items: folders.items.map((item) => item.key), prefixes: folders.prefixes ?? null },
  };
}

export async function mutate() {
  const files = new Files({ adapter: memory() });
  await files.upload("src.txt", "copy me", { contentType: "text/plain" });
  await files.copy("src.txt", "dst.txt");
  const copied = await files.download("dst.txt");
  const afterCopy = { src: await files.exists("src.txt"), dst: await files.exists("dst.txt"), text: await copied.text() };
  await files.delete("src.txt");
  const remaining = await files.list();
  return {
    afterCopy,
    afterDelete: { src: await files.exists("src.txt"), keys: remaining.items.map((item) => item.key) },
  };
}

export async function handles() {
  const files = new Files({ adapter: memory() });
  const handle = files.file("notes/today.md");
  const before = await handle.exists();
  await handle.upload("# today", { contentType: "text/markdown" });
  const got = await handle.download();
  const head = await handle.head();
  await handle.copyTo("notes/copy.md");
  await handle.delete();
  return {
    key: handle.key,
    before,
    text: await got.text(),
    head: info(head),
    after: await handle.exists(),
    copy: await files.file("notes/copy.md").exists(),
  };
}

export async function errors() {
  const files = new Files({ adapter: memory() });
  return {
    missingDownload: await attempt(async () => (await files.download("missing.txt")).key),
    missingHead: await attempt(async () => info(await files.head("missing.txt"))),
    emptyKey: await attempt(async () => info(await files.upload("", "x"))),
    missingCopy: await attempt(async () => {
      await files.copy("missing.txt", "dst.txt");
      return "copied";
    }),
  };
}
