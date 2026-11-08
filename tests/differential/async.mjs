// Promise ordering, generators and async iteration. Every export runs under Node and through the
// generated PHP; the logs must match exactly, because job order is observable in JavaScript.
// See docs/decisions/2026-11-07-promises-generators-streams.md.

const tick = () => null;

// Interleaving of async bodies, reaction chains and the caller's own awaits.
export async function interleaving() {
  const log = [];
  const body = async (name) => {
    log.push(name + ":1");
    await tick();
    log.push(name + ":2");
    await null;
    log.push(name + ":3");
  };
  Promise.resolve().then(() => log.push("then:1")).then(() => log.push("then:2")).then(() => log.push("then:3"));
  body("a");
  body("b");
  log.push("sync");
  await Promise.resolve();
  log.push("root");
  await null;
  await null;
  await null;
  return log;
}

// Adoption costs: an async function returning a promise, a thenable, and Promise.resolve(promise).
export async function adoption() {
  const log = [];
  const returnsPromise = async () => Promise.resolve("p");
  const thenable = { then(resolve) { log.push("thenable.then"); resolve("t"); } };
  returnsPromise().then((v) => log.push("async-returned:" + v));
  Promise.resolve(thenable).then((v) => log.push("thenable:" + v));
  const native = Promise.resolve("n");
  log.push(Promise.resolve(native) === native ? "same" : "wrapped");
  native.then(() => log.push("n1")).then(() => log.push("n2")).then(() => log.push("n3")).then(() => log.push("n4"));
  for (let i = 0; i < 6; i++) await null;
  return log;
}

// Combinators with mixed values and rejection propagation.
export async function combinators() {
  const log = [];
  const later = async (v) => { await null; log.push("later:" + v); return v; };
  const all = await Promise.all([later(1), 2, Promise.resolve(3), later(4)]);
  log.push("all:" + all.join(","));
  const settled = await Promise.allSettled([Promise.reject("no"), later(5), 6]);
  log.push("settled:" + settled.map((s) => s.status + "=" + (s.status === "fulfilled" ? s.value : s.reason)).join(","));
  const raced = await Promise.race([later("slow"), "fast"]);
  log.push("race:" + raced);
  try {
    await Promise.all([later(7), Promise.reject(new Error("first")), Promise.reject(new Error("second"))]);
  } catch (error) {
    log.push("all-rejected:" + error.message);
  }
  const chained = await Promise.reject(new Error("boom"))
    .then(() => "skipped")
    .catch((error) => "caught:" + error.message)
    .finally(() => log.push("finally"));
  log.push(chained);
  try {
    await Promise.resolve(1).finally(() => { throw new Error("from-finally"); });
  } catch (error) {
    log.push("finally-throw:" + error.message);
  }
  const executed = await new Promise((resolve, reject) => {
    log.push("executor");
    resolve("first");
    reject(new Error("ignored"));
    resolve("ignored");
  });
  log.push(executed);
  try {
    await new Promise(() => { throw new TypeError("executor-throw"); });
  } catch (error) {
    log.push(error.name + ":" + error.message);
  }
  try { await Promise.reject("plain"); } catch (value) { log.push("non-error:" + typeof value + ":" + value); }
  return log;
}

// A rejection handled in a later job is not unhandled; handler end drains the queue first.
export async function lateHandling() {
  const log = [];
  const rejected = Promise.reject(new Error("late"));
  await null;
  rejected.catch((error) => log.push("handled:" + error.message));
  Promise.resolve().then(() => log.push("drained-after-return"));
  return log;
}

// Sync generators: next/return/throw, yield*, finally on early exit.
function* counter(log, limit) {
  try {
    for (let i = 0; i < limit; i++) {
      const sent = yield i;
      if (sent !== undefined) log.push("sent:" + sent);
    }
    return "done";
  } finally {
    log.push("counter-finally");
  }
}
function* outer(log) {
  const inner = yield* counter(log, 2);
  log.push("inner-returned:" + inner);
  yield "tail";
}
function* cleanup(log) {
  try { yield 1; } finally { yield "from-finally"; log.push("cleanup-done"); }
}
export function generators() {
  const log = [];
  const it = counter(log, 3);
  log.push(JSON.stringify(it.next("ignored")));
  log.push(JSON.stringify(it.next("x")));
  log.push(JSON.stringify(it.return("early")));
  log.push(JSON.stringify(it.next()));
  for (const v of counter(log, 10)) { log.push("loop:" + v); if (v === 1) break; }
  log.push([...outer(log)].join(","));
  const thrown = counter(log, 3);
  thrown.next();
  try { thrown.throw(new Error("into")); } catch (error) { log.push("rethrown:" + error.message); }
  log.push(JSON.stringify(thrown.next()));
  const c = cleanup(log);
  c.next();
  log.push(JSON.stringify(c.return("r")));
  log.push(JSON.stringify(c.next()));
  return log;
}

// Async generators and for await: pagination with yield*, early exit closes the source.
const store = { "a/1": "x", "a/2": "yy", "b/1": "zzz", "a/3": "w", c: "" };
function list(opts) {
  const keys = Object.keys(store).sort();
  const start = opts.cursor ? Number(opts.cursor) : 0;
  const items = keys.slice(start, start + opts.limit).map((key) => ({ key, size: store[key].length }));
  return Promise.resolve({ items, cursor: start + opts.limit < keys.length ? String(start + opts.limit) : undefined });
}
async function* listAll(limit) {
  let cursor;
  while (true) {
    const page = await list(cursor ? { limit, cursor } : { limit });
    yield* page.items;
    cursor = page.cursor;
    if (!cursor) return;
  }
}
async function* search(log, prefix, max) {
  let found = 0;
  try {
    for await (const file of listAll(2)) {
      if (file.key.startsWith(prefix)) {
        yield file.key;
        found += 1;
        if (found >= max) return;
      }
    }
  } finally {
    log.push("search-finally");
  }
}
export async function pagination() {
  const log = [];
  for await (const file of listAll(2)) log.push(file.key + ":" + file.size);
  for await (const key of search(log, "a/", 2)) log.push("found:" + key);
  for await (const key of search(log, "", 9)) { log.push("first:" + key); break; }
  for await (const v of [Promise.resolve("sync-source"), "plain"]) log.push(v);
  const it = listAll(10);
  const pair = await Promise.all([it.next(), it.next()]);
  log.push("queued:" + pair[0].value.key + "," + pair[1].value.key);
  log.push(JSON.stringify(await it.return("stop")));
  return log;
}
