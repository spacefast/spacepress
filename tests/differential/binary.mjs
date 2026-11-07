// Byte values in imported JavaScript: each exported function runs under Node and as compiled PHP, and the
// results must be identical. Results are strings so the comparison is exact.
const textEncoder = new TextEncoder();
const SINES = Uint32Array.of(3614090360, 4294967295, -1, 4294967296.5);
const SHIFTS = Uint8Array.of(7, 12, 256, -1);

const caught = (f) => {
  try {
  return `ok:${f()}`;
  } catch (error) {
  return error.name;
  }
};

export function wraparound() {
  const a = new Uint8Array(6);
  a[0] = 256; a[1] = -129; a[2] = 3.9; a[3] = -0.5; a[4] = NaN; a[5] = 1e20;
  const i = new Int8Array(3);
  i[0] = 200; i[1] = -200; i[2] = 128;
  const c = new Uint8ClampedArray(5);
  c[0] = 300; c[1] = -5; c[2] = 2.5; c[3] = 3.5; c[4] = 0.5000001;
  const w = new Uint16Array(2);
  w[0] = 70000; w[1] = -1;
  const s = new Int32Array(2);
  s[0] = 2147483648; s[1] = -2147483649;
  const f = new Float32Array(2);
  f[0] = 0.1; f[1] = -0;
  return [...a, "|", ...i, "|", ...c, "|", ...w, "|", ...s, "|", f[0], 1 / f[1], "|", ...SINES, "|", ...SHIFTS].join(",");
}
export function sharedViews() {
  const buf = new ArrayBuffer(8);
  const all = new Uint8Array(buf);
  const mid = all.subarray(2, 6);
  const copy = all.slice(2, 6);
  mid.fill(7, 1, 3);
  mid[0] = 9;
  mid[10] = 1;
  const view = new Uint8Array(buf, 4);
  view[1] = 5;
  const dv = new DataView(buf, 1);
  dv.setUint16(0, 0x0102);
  dv.setInt8(6, -2);
  const u32 = new Uint32Array(buf);
  return [
    [...all], [...copy], mid.byteOffset, view.byteOffset, view.length, mid.buffer === buf,
    u32[0], u32[1], dv.getUint32(0, true), dv.getInt16(5), dv.getFloat32(0),
    JSON.stringify(mid), Object.keys(mid), mid[10], mid["-0"], mid.length,
  ].join("|");
}
export function setAndSearch() {
  const a = Uint8Array.of(1, 2, 3, 4, 5, 6);
  a.set(a.subarray(0, 4), 2);
  const wide = new Uint16Array([1, 2, 65535]);
  const narrowed = new Uint8Array(wide);
  const refused = caught(() => a.set([1, 2], 5));
  return [
    [...a], [...narrowed], refused, a.indexOf(3), a.indexOf(3, 3), a.lastIndexOf(1), a.includes(9), a.indexOf(256),
    a.indexOf("1"), Uint8Array.from("123", (x) => x * 2).join("-"), a.at(-1), new Float64Array([NaN]).includes(NaN),
    new Float64Array([NaN]).indexOf(NaN),
  ].join("|");
}
export function iteration() {
  const a = Uint8Array.of(5, 6, 7);
  let sum = 0;
  for (const x of a) sum += x;
  return [
    sum, [...a.entries()].join(";"), [...a.keys()].join(""), Array.from(a).length, a.map((x) => x * 100).join("-"),
    a.filter((x) => x > 5).length, a.reduce((p, x) => p + x), a.join(), a.some((x) => x === 7), a.every((x) => x > 4),
    a.find((x) => x > 5), a.findIndex((x) => x > 9), String(a), String(a.subarray(1).reverse()), [...a].join(""),
    typeof a, a.BYTES_PER_ELEMENT, Uint32Array.BYTES_PER_ELEMENT, a instanceof Uint8Array, a instanceof Uint16Array,
    ArrayBuffer.isView(a), ArrayBuffer.isView(a.buffer), typeof Uint8Array, Uint8Array.name,
  ].join(",");
}
export function buffers() {
  const b = new ArrayBuffer(5);
  new Uint8Array(b).set([1, 2, 3, 4, 5]);
  const c = b.slice(1, -1);
  new Uint8Array(c)[0] = 9;
  const cloned = structuredClone(new Uint8Array(b, 1, 2));
  cloned[0] = 0;
  return [
    b.byteLength, c.byteLength, [...new Uint8Array(b)].join(""), [...new Uint8Array(c)].join(""), JSON.stringify(b),
    JSON.stringify({ u: new Uint8Array(2), d: new DataView(b) }), b instanceof ArrayBuffer, cloned.byteOffset,
    new Uint8Array(b)[1], new Uint8Array(new Uint16Array([258]).buffer).join(),
  ].join(",");
}
export function invalidUtf8() {
  const decoder = new TextDecoder();
  const sequences = [
    [0xc0, 0xaf], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf0, 0x9f, 0x98], [0xe2, 0x82],
    [0x80, 0xbf], [0xfe, 0xff], [0xef, 0xbb, 0xbf, 0x41], [0xf0, 0x9f, 0x98, 0x80], [0xc2], [0xe1, 0x80, 0x41],
    [0xf1, 0x80, 0x80, 0xc0], [0xc3, 0xa9, 0xff, 0x41], [0xf5, 0x80], [0xe0, 0xa0], [0xef, 0xbf, 0xbf],
  ];
  const decoded = sequences.map((bytes) => [...textEncoder.encode(decoder.decode(new Uint8Array(bytes)))].join("."));
  const keepBom = new TextDecoder("utf-8", { ignoreBOM: true }).decode(Uint8Array.of(0xef, 0xbb, 0xbf, 0x41));
  const fatal = caught(() => new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.of(0xc3)));
  return [
    ...decoded, keepBom.length, decoder.decode(new Uint8Array(0)).length, decoder.decode().length, fatal,
    new TextDecoder(" UTF8 ").encoding, new TextDecoder("unicode-1-1-utf-8").encoding, new TextDecoder("utf-8", { fatal: true }).fatal,
    decoder.decode(new DataView(textEncoder.encode("dv").buffer)),
  ].join("|");
}
export function textRoundTrip() {
  const input = "h\u00e9llo \u{1F600}";
  const bytes = textEncoder.encode(input);
  const into = new Uint8Array(5);
  const result = textEncoder.encodeInto(input, into);
  return [bytes.length, new TextDecoder().decode(bytes), [...bytes.subarray(0, 3)], result.read, result.written, [...into]].join("|");
}
export function blobs() {
  const file = new File(["ab", new Uint8Array([99, 100]), new Blob(["é"])], "n.txt", { type: "TEXT/Plain", lastModified: 42 });
  const tail = file.slice(-3);
  return [
    file.size, file.type, file.name, file.lastModified, file instanceof Blob, file instanceof File, tail.size, tail.type,
    tail instanceof File, JSON.stringify(file), new Blob([], { type: "aé" }).type === "", String(new Blob()),
    new Blob(["x"]).name, typeof file.arrayBuffer, file.slice(1, 4, "q/R").type, typeof new File([], "x").lastModified,
    new Blob(["a\r\nb\rc\n", new Uint8Array([13])], { endings: "native" }).size, caught(() => new Blob([], { endings: "crlf" })), caught(() => new File(["x"])),
  ].join(",");
}
export function base64() {
  return [btoa(""), btoa("abÿ"), atob(" YW Jj "), atob("YQ=="), atob(btoa("ÿé")) === "ÿé", caught(() => atob("a")), caught(() => btoa("Ā"))].join(",");
}
export function errors() {
  return [
    () => new Uint8Array(-1), () => new Uint8Array(new ArrayBuffer(3), 1, 4), () => new Uint16Array(new ArrayBuffer(3)),
    () => new DataView(new ArrayBuffer(2)).getUint32(0), () => new Uint16Array(new ArrayBuffer(4), 1),
    () => new DataView(new ArrayBuffer(2), 3), () => (255).toString(37),
  ].map(caught).join(",");
}
export function radix() {
  return [(255).toString(16), (-255).toString(2), (0).toString(36), (35).toString(36), (4294967295).toString(16).padStart(8, "0")].join(",");
}
