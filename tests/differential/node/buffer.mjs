// Buffer and node:buffer in imported JavaScript: each export runs under Node and as compiled PHP
// (tests/compiler_contracts.rs `binary_data_matches_node_through_generated_php`), with equal results.
// Errors are compared by name and code, not message. Buffers here never share Node's 8 KiB pool, so
// no case reads `buf.buffer` of a small Buffer made by from, concat or allocUnsafe.
import { Buffer as Imported, constants, kMaxLength, atob, btoa } from "node:buffer";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const caught = (f) => {
  try {
    const value = f();
    return value instanceof Uint8Array ? [...value] : value;
  } catch (error) {
    return `${error.name}:${error.code}`;
  }
};
const ENCODINGS = ["utf8", "utf-8", "hex", "base64", "base64url", "latin1", "binary", "ascii", "utf16le", "ucs2"];

export function bufferEncodings() {
  const text = "é😀 ok";
  const out = ENCODINGS.map((e) => Buffer.from(text).toString(e));
  out.push(ENCODINGS.map((e) => [...Buffer.from(text, e)].join(".")).join("|"));
  out.push([...Buffer.from("abc", "hex")], [...Buffer.from("abzz12", "HEX")], [...Buffer.from("YQ", "base64")]);
  out.push([...Buffer.from("YQ==", "base64url")], [...Buffer.from("-_8", "base64")], [...Buffer.from("+/8=", "base64url")]);
  out.push([...Buffer.from(" Y Q\n= =", "base64")], [...Buffer.from("YQ==YQ==", "base64")], [...Buffer.from("YWJjZ", "base64")]);
  out.push([...Buffer.from("Y", "base64")], [...Buffer.from("Y!Q", "base64")]);
  const latin = Buffer.from("\xff\x00", "latin1");
  out.push([...latin], latin.toString("latin1") === "\xff\x00", Buffer.from([0xff, 0x41, 0x80]).toString("ascii"));
  out.push([...Buffer.from("\xffĀé😀", "latin1")], Buffer.from([0xe2, 0x82, 0x41, 0xff]).toString());
  out.push(Buffer.from([0xef, 0xbb, 0xbf, 0x61]).toString().length, Buffer.from([0x61, 0, 0x62]).toString("utf16le"));
  out.push(Buffer.from("hello").toString("utf8", 1, 3), Buffer.from("hello").toString(undefined, 2), Buffer.from("hello").toString("hex", 3, 1));
  out.push(Buffer.byteLength("YQ==", "base64"), Buffer.byteLength("Y!Q", "base64"), Buffer.byteLength("abc", "hex"));
  out.push(Buffer.byteLength("é😀", "latin1"), Buffer.byteLength("é😀", "utf16le"), Buffer.byteLength("é😀"), Buffer.byteLength("abc", "nope"));
  out.push(Buffer.byteLength(new Uint16Array(2)), Buffer.byteLength(new ArrayBuffer(3)));
  out.push(caught(() => Buffer.from("a", "nope")), caught(() => Buffer.from("a").toString("nope")), caught(() => Buffer.from("a").toString(null)));
  out.push(Buffer.from("YQ==", "").length, Buffer.from("YQ==", null).length, Buffer.from("AQID", "BASE64").length);
  out.push(["UTF-8", "binary", "ucs-2", "nope", ""].map((e) => Buffer.isEncoding(e)));
  // Hex and base64 read the low byte of each UTF-16 unit, so "😀" ends base64 at its "=" byte.
  out.push(["😀YQ", "YWĀJj", "YWJţ", "YWJjZAĀ=="].map((t) => [...Buffer.from(t, "base64")].join(".")));
  out.push(["aŢ", "Ţa"].map((t) => [...Buffer.from(t, "hex")].join(".")), Buffer.byteLength("aŢ", "base64"));
  return out;
}

export function bufferInterop() {
  const joined = Buffer.concat([Buffer.from("a"), new Uint8Array([98]), Buffer.alloc(2, 1)]);
  const copied = new Uint8Array(Buffer.from("x"));
  const ab = new Uint8Array([1, 2, 3, 4]).buffer;
  const view = Buffer.from(ab, 1, 2);
  view[0] = 9;
  const s = Buffer.from("abc");
  const sub = s.subarray(1);
  sub[0] = 0x7a;
  const sliced = s.slice(2);
  sliced[0] = 0x79;
  const bytes = Buffer.from("payload");
  return [
    joined.toString("hex"),
    Buffer.isBuffer(new Uint8Array(1)), Buffer.isBuffer(joined), Buffer.isBuffer("x"),
    copied instanceof Uint8Array, Buffer.isBuffer(copied), joined instanceof Uint8Array, joined instanceof Buffer,
    Imported === Buffer, typeof Buffer, Buffer.name, Object.prototype.toString.call(joined),
    [...new Uint8Array(ab)], view.length, view.byteOffset, Buffer.from(Buffer.alloc(3).buffer).length,
    s.toString(), Buffer.isBuffer(sub), Buffer.isBuffer(sliced), Buffer.isBuffer(s.map((x) => x)), Buffer.isBuffer(new Uint8Array(s).subarray(1)),
    [...Buffer.concat([Buffer.from("ab"), Buffer.from("c")], 5)], [...Buffer.concat([Buffer.from("ab"), Buffer.from("c")], 2)],
    caught(() => Buffer.concat([Buffer.from("a"), "b"])), caught(() => Buffer.concat("ab")),
    [...Buffer.from([256, -1, 1.9, "7", null, "x"])], [...Buffer.from(new Uint16Array([256, 1]))], [...Buffer.from({ length: 2, 0: 300, 1: -1 })],
    [...Buffer.from({ type: "Buffer", data: [1, 2] })], [...Buffer.from({ length: "2" })], caught(() => Buffer.from({})), caught(() => Buffer.from(1)),
    caught(() => Buffer.from(ab, 5)), [...Buffer.of(1, 2)], Buffer.isBuffer(Buffer.of(1)),
    createHash("sha256").update(bytes).update(new Uint8Array([1])).update(new DataView(new ArrayBuffer(2))).digest("hex"),
    createHmac("sha256", Buffer.from("key")).update("x").digest().toString("base64"),
    createHmac("sha256", new Uint8Array([1, 2])).update(Buffer.from("x")).digest("hex"),
    createHash("sha1").update("ff", "hex").digest("hex") === createHash("sha1").update(Buffer.from([255])).digest("hex"),
    Buffer.isBuffer(createHash("md5").digest()), createHash("md5").digest().length,
    timingSafeEqual(Buffer.from("ab"), new Uint8Array([97, 98])), timingSafeEqual(new ArrayBuffer(2), new Uint16Array(1)),
    caught(() => timingSafeEqual("a", "a")), caught(() => createHash("sha256").update(new ArrayBuffer(1))),
    `${Buffer.from("tpl")}`, String(Buffer.from("hé")), Buffer.from("x") + "y",
    btoa("hi"), atob("aGk="), constants.MAX_LENGTH === kMaxLength, typeof constants.MAX_STRING_LENGTH,
  ];
}

export function bufferJson() {
  return [
    JSON.stringify({ b: Buffer.from([1, 2]) }), JSON.stringify(Buffer.alloc(0)), JSON.stringify(Buffer.from("ab").toJSON()),
    JSON.stringify(new Uint8Array([1])), JSON.stringify(structuredClone(Buffer.from("a"))), Buffer.isBuffer(structuredClone(Buffer.from("a"))),
  ];
}

export function bufferInts() {
  const b = Buffer.alloc(8);
  const writes = [
    b.writeUInt8(0xab, 0), b.writeUInt8(0x12, 3), b.writeUInt16BE(0x1234, 0), b.writeUInt16LE(0x1234, 3),
    b.writeUInt32BE(0xdeadbeef, 0), b.writeUInt32LE(0xdeadbeef, 3), b.writeInt32BE(-2, 0), b.writeInt32LE(-2, 3),
    b.writeInt8(-1, 7), b.writeInt16LE(-2.5, 0), b.writeUInt8(1.7, 2), b.writeUInt8("9", 1), b.writeUInt8(NaN, 6),
  ];
  const r = Buffer.from([1, 2, 3, 4, 5, 6, 7, 0xff]);
  const reads = [
    r.readUInt8(0), r.readUInt8(3), r.readUInt16BE(0), r.readUInt16LE(3), r.readUInt32BE(0), r.readUInt32LE(3),
    r.readInt32BE(0), r.readInt32LE(3), r.readInt8(7), r.readInt16BE(6), r.readUint8(), r.readUint32LE(),
    Buffer.from([0xff, 0xff, 0xff, 0xff]).readInt32LE(), Buffer.from([0x80, 0, 0, 0]).readInt32BE(),
    r.readBigUInt64BE(0).toString(), r.readBigUInt64LE().toString(), typeof r.readBigUInt64BE(),
  ];
  const errors = [
    caught(() => Buffer.alloc(2).readUInt8(5)), caught(() => Buffer.alloc(1).readUInt16LE(0)),
    caught(() => Buffer.alloc(4).readUInt8(1.5)), caught(() => Buffer.alloc(4).readUInt8("1")),
    caught(() => Buffer.alloc(4).readUInt32BE(1)), caught(() => Buffer.alloc(4).writeUInt8(256, 0)),
    caught(() => Buffer.alloc(4).writeUInt8(-1, 0)), caught(() => Buffer.alloc(4).writeUInt32BE(2 ** 32, 0)),
    caught(() => Buffer.alloc(4).writeUInt16BE(1, 3)), caught(() => Buffer.alloc(4).readInt8(-1)),
  ];
  return [writes, [...b], reads, errors];
}

export function bufferMethods() {
  const w = Buffer.alloc(6);
  const writes = [w.write("héllo", 1), [...w], w.write("ff", 0, "hex"), w.write("abc", 4, 1), w.write("x", "latin1")];
  const room = Buffer.alloc(4);
  room.write("€€", 1);
  const small = Buffer.alloc(3);
  small.write("😀");
  const b = Buffer.from("abcabc");
  const t = Buffer.alloc(6);
  return [
    writes, [...room], [...small], Buffer.alloc(4).write("abcdef", "hex"), Buffer.alloc(4).write("abcdef", 1, 2, "hex"),
    caught(() => Buffer.alloc(4).write("a", 10)), Buffer.alloc(4).write("a", 4), caught(() => Buffer.alloc(4).write(1)),
    [b.indexOf("c"), b.indexOf("c", 3), b.indexOf(Buffer.from("bc")), b.indexOf(98), b.includes("ca"), b.indexOf("62", 0, "hex")],
    [b.lastIndexOf("b"), b.indexOf("", 9), b.lastIndexOf("c", -1), b.lastIndexOf("b", 3), b.indexOf("b", -2), b.indexOf(354), b.lastIndexOf(""), b.indexOf("c", "latin1"), b.indexOf("zz"), b.includes(new Uint8Array([99, 97]))],
    [Buffer.from("abcd").copy(t, 1, 1, 3), [...t], Buffer.alloc(4).copy(Buffer.alloc(2), 3), caught(() => Buffer.alloc(4).copy(Buffer.alloc(2), 0, 5)), caught(() => Buffer.alloc(1).copy("x"))],
    [Buffer.compare(Buffer.from("a"), Buffer.from("b")), Buffer.from("b").compare(Buffer.from("a")), Buffer.from("ab").equals(Buffer.from("ab")), Buffer.from("ab").equals(new Uint8Array([97, 99]))],
    [Buffer.from("abc").compare(Buffer.from("xbcx"), 1, 3, 1, 3), Buffer.from("abc").compare(Buffer.from("b"), 5), caught(() => Buffer.from("a").equals("a")), caught(() => Buffer.compare("a", Buffer.from("a")))],
    [Buffer.alloc(4).fill("a", 1, 3).toString("hex"), Buffer.alloc(4).fill("ab", "latin1").toString(), [...Buffer.alloc(4).fill(1, 5)], [...Buffer.alloc(5, "ab")], [...Buffer.alloc(3, "")]],
    [[...Buffer.alloc(2, 300)], [...Buffer.alloc(2, -1)], Buffer.alloc(3, Buffer.from("ab")).toString(), Buffer.alloc(4, "6162", "hex").toString(), Buffer.allocUnsafe(3).length],
    [caught(() => Buffer.alloc(3, "zz", "hex")), caught(() => Buffer.alloc(-1)), caught(() => Buffer.alloc("3")), caught(() => Buffer.alloc(NaN)), Buffer.alloc(1.5).length],
    [JSON.stringify(Buffer.from("ab").toJSON()), Buffer.from("ab").reverse().toString(), Buffer.from("abc").at(-1), [...Buffer.from("ab").entries()].join(";")],
  ];
}
