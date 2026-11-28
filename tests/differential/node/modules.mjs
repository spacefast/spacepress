import path, { posix, sep, delimiter } from "node:path";
import querystring, { decode, encode, escape, parse, stringify, unescape } from "node:querystring";
import { StringDecoder } from "node:string_decoder";
import util, { callbackify, deprecate, format, inherits, inspect, isDeepStrictEqual, promisify, TextDecoder, TextEncoder, types } from "node:util";
import EventEmitter, { EventEmitter as NamedEmitter, once } from "node:events";
import { createSecretKey, webcrypto } from "node:crypto";
import { eventClassIdentity } from "./events.cjs";

const pathConstants = [path.sep, path.delimiter, sep, delimiter, path.posix === posix];

const caught = (run) => {
  try {
    return run();
  } catch (error) {
    return [error.name, error.code];
  }
};

export function nodePath() {
  return [
    pathConstants, path === posix, path.posix.join("a", "b"), path["sep"],
    path.join("/foo", "bar", "baz/asdf", "quux", ".."), path.join("", "0"),
    path.resolve("/foo/bar", "./baz", "../here"), path.resolve("/a", "/b", "..", "x"),
    path.normalize("/foo/bar//baz/asdf/quux/.."), path.normalize("a/../"),
    path.normalize("../../a/"), path.normalize(""), path.normalize("///../../."),
    path.relative("/data/orandea/test/aaa", "/data/orandea/impl/bbb"),
    path.relative("/", "/a"), path.relative("/a/b", "/a"), path.relative("/a", "/a"),
    path.dirname("/foo/bar/baz/asdf/quux"), path.dirname("//x"), path.dirname("abc"),
    path.basename("/foo/bar/baz/asdf/quux.html", ".html"), path.basename("/foo", "foo"),
    path.basename("foo", "foo"), path.basename("a/0"), path.basename("//", "😀"), path.extname("index."), path.extname(".index"),
    path.extname(".index.md"), path.extname(".."), path.extname("a/b///"),
    path.isAbsolute(""), path.isAbsolute("/foo/.."), path.isAbsolute("C:\\foo"),
    path.parse("/home/user/dir/file.txt"), path.parse("/.."), path.parse("//x"), path.parse("relative"),
    path.format({ root: "/", dir: "/home/user/dir", base: "file.txt" }),
    path.format({ root: "/", name: "file", ext: "txt" }), path.format({ root: "/", name: "file", ext: ".txt" }),
    path.toNamespacedPath("/home/user"), path.toNamespacedPath(0),
    path.format(new Date(0)), caught(() => path.format([])),
    caught(() => path.join("a", 1)), caught(() => path.basename("a", null)),
    caught(() => path.resolve(1, "/a")), caught(() => path.parse(null)),
  ];
}

export function nodeQueryString() {
  const parsed = parse("x=a+x&x=b%20c&__proto__=key&constructor=plain&x[]=%E0%A4%A");
  return [
    parsed, Object.keys(parsed), "hasOwnProperty" in parsed, decode === parse, encode === stringify,
    querystring.parse("?a=x+y"),
    parse("a==1&&b==2&&c==3", "&&", "==", { maxKeys: 2 }),
    parse("a&&b", "&", "=", { maxKeys: 2 }), parse("a&&b", "&", "=", { maxKeys: 0 }),
    parse("aab", "ab", "a"), parse("x😀=y😀z", "😀", "="),
    parse(null), parse("0=zero&2=two&1=one&01=leading"), parse("a=b==&=x&c&&"),
    stringify({ foo: "bar baz", baz: ["qux", "quux"], corge: "" }),
    encode({ word: ["é", "😀"], flag: true, nil: null, nope: undefined, n: NaN, inf: Infinity, big: 12n }, ";", ":"),
    encode({ a: [], b: [true, {}, 1], c: "!" }), escape("a+ b/é!'()*~"), unescape("+%FF%E2%82%AC%no"),
  ];
}

export function nodeStringDecoder() {
  const decoder = new StringDecoder("UTF-8");
  const euro = Buffer.from("€");
  const utf8 = [decoder.write(euro.subarray(0, 1)), decoder.write(euro.subarray(1, 2)), decoder.write(euro.subarray(2)), decoder.end()];
  const utf16 = new StringDecoder("ucs-2");
  const couple = Buffer.from("😀a", "utf16le");
  const split = [utf16.write(couple.subarray(0, 2)), utf16.write(couple.subarray(2, 5)), utf16.end(couple.subarray(5))];
  const base64 = new StringDecoder("base64");
  return [
    decoder instanceof StringDecoder, decoder.encoding, utf8, split,
    base64.write(Buffer.from("a")), base64.write(Buffer.from("bcde")), base64.end(),
    base64.write(Buffer.from("ab")), base64.end(Buffer.from("c")),
    decoder.write(Buffer.from([0xe2, 0x82])), decoder.end(), decoder.write("abc"),
    new StringDecoder("binary").end(Buffer.from([255, 233])), new StringDecoder("hex").end(Buffer.from([97, 255])),
    new StringDecoder().end(new Uint8Array([0x61])), caught(() => decoder.write(null)),
    caught(() => decoder.end(null)), caught(() => new StringDecoder("bad")),
  ];
}

class UtilityBase {
  method() { return "base"; }
  static staticMethod() { return "static"; }
}
class UtilityChild {}

export function nodeUtil() {
  const nested = { a: { b: { c: { d: 1 } } } };
  const circular = { name: "circle" };
  circular.self = circular;
  inherits(UtilityChild, UtilityBase);
  const child = new UtilityChild();
  const deprecated = deprecate((x) => x * 2, "the fixture uses deprecate");
  return [
    format("%s:%d:%j", "a", 1.5, { x: 1 }), format("%d:%i:%f:%s:%%", "2.5", "10x", "1.23x", Symbol("y")),
    format("%o|%O", [1], { a: 2 }), format("%j", circular), format(nested, "tail"), format("%%"), format(undefined, "x"),
    inspect(nested, { depth: 2 }), inspect(nested, { depth: 0 }), inspect(nested, { depth: null }), inspect(circular),
    inspect(new Map([["a", 1]])), inspect(new Set(["a", 1])), inspect(new Date(0)), inspect(Buffer.from("ab")),
    inspect(undefined), inspect(false), inspect(-0), inspect(12n), inspect("one\ntwo"),
    inspect(createSecretKey(Buffer.from("secret"))), util.format === format,
    [...new TextEncoder().encode("café")], new TextDecoder().decode(new Uint8Array([0x61])),
    types.isUint8Array(Buffer.from("x")), types.isUint8Array(new Uint16Array(1)), types.isArrayBuffer(new ArrayBuffer(0)),
    types.isDate(new Date(0)), types.isRegExp(/a/), types.isPromise(Promise.resolve(1)), types.isKeyObject(createSecretKey("key")),
    isDeepStrictEqual({ a: [1, NaN], b: 2 }, { b: 2, a: [1, NaN] }),
    isDeepStrictEqual({ a: 0 }, { a: -0 }), isDeepStrictEqual(new Set([{ x: 1 }, 2]), new Set([2, { x: 1 }])),
    isDeepStrictEqual(new Map([[{ k: 1 }, "v"]]), new Map([[{ k: 1 }, "v"]])),
    isDeepStrictEqual(Buffer.from("abc"), new Uint8Array([97, 98, 99])),
    child.method(), child instanceof UtilityBase, UtilityChild.super_ === UtilityBase, "super_" in UtilityChild, typeof UtilityChild.staticMethod,
    typeof deprecated, inspect(new TypeError("invalid")).split("\n")[0].replace(/^\[|\]$/g, ""),
  ];
}

export async function nodeUtilAsync() {
  const object = {
    n: 3,
    add(value, callback) { callback(null, this.n + value); },
  };
  object.asyncAdd = promisify(object.add);
  const failed = promisify((cb) => { cb(new Error("failed")); });
  let failure;
  try { await failed(); } catch (error) { failure = error.message; }
  object.callbackAdd = callbackify(async function (x) { return this.n + x; });
  const called = await new Promise((resolve) => object.callbackAdd(5, (err, value) => resolve([err, value])));
  const rejected = callbackify(() => Promise.reject(null));
  const reason = await new Promise((resolve) => rejected((error) => resolve([error.code, error.reason, error instanceof Error])));
  const key = await webcrypto.subtle.importKey("raw", Buffer.from("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [await object.asyncAdd(2), failure, called, reason, types.isCryptoKey(key), types.isKeyObject(key)];
}

class Counter extends EventEmitter {
  constructor(n) {
    super();
    this.n = n;
  }
  increment() {
    this.n += 1;
    return this.emit("count", this.n);
  }
}
class DefaultCounter extends NamedEmitter {
  value = 7;
}

export function nodeEvents() {
  const result = [];
  const counter = new Counter(0);
  const listener = function (n) { result.push(`normal:${n}:${this === counter}`); };
  const first = (n) => result.push(`first:${n}`);
  const single = (n) => result.push(`once:${n}`);
  const chain = counter.setMaxListeners(4).on("count", listener).once("count", single).prependListener("count", first);
  const before = [counter.listeners("count").length, counter.listeners("count")[2] === single, counter.listenerCount("count")];
  counter.increment();
  counter.removeListener("count", first);
  counter.increment();
  counter.off("count", listener);
  const empty = counter.increment();
  const event = Symbol("event");
  counter.on(event, () => {});
  counter.addListener("extra", () => {});
  const events = counter.eventNames().map((x) => String(x));
  counter.removeAllListeners(event);
  const leftover = counter.eventNames();
  counter.removeAllListeners();
  let propagated;
  const error = new RangeError("bad");
  try { counter.emit("error", error); } catch (caught) { propagated = caught === error; }
  return [
    EventEmitter === NamedEmitter, EventEmitter.EventEmitter === NamedEmitter, EventEmitter.once === once, eventClassIdentity(),
    EventEmitter.defaultMaxListeners, counter.getMaxListeners(), chain === counter,
    counter.on === counter.addListener, counter.off === counter.removeListener,
    counter instanceof EventEmitter, counter instanceof Counter, new DefaultCounter().value, before, result, empty,
    events, leftover, counter.eventNames(), propagated, caught(() => counter.emit("error", "bad")),
  ];
}

export async function nodeEventsAsync() {
  const emitter = new EventEmitter();
  const pending = once(emitter, "ready");
  emitter.emit("ready", "a", 2);
  const resolved = await pending;
  const failed = once(emitter, "data");
  emitter.emit("error", new Error("failed"));
  let message;
  try { await failed; } catch (error) { message = error.message; }
  const pendingError = once(emitter, "error");
  emitter.emit("error", "caught");
  return [resolved, message, await pendingError, emitter.eventNames()];
}
