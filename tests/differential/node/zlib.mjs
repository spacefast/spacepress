import * as zlib from "node:zlib";

function errorOf(run) {
  try {
    run();
  } catch (error) {
    return `${error.name}:${error.code}`;
  }
  return "no error";
}

export function zlibRoundTrips() {
  const text = "hello".repeat(100);
  const gzip1 = zlib.gzipSync(text, { level: zlib.constants.Z_BEST_SPEED });
  const gzip6 = zlib.gzipSync(text, { level: 6 });
  const gzip9 = zlib.gzipSync(text, { level: zlib.constants.Z_BEST_COMPRESSION });
  const deflated = zlib.deflateSync(text, { windowBits: 9, memLevel: 2, strategy: zlib.constants.Z_FIXED });
  const raw = zlib.deflateRawSync(text, { windowBits: 8 });
  const fromNode = Buffer.from("1f8b0800000000000003cb48cdc9c9070086a6103605000000", "hex");
  const multiMember = Buffer.concat([fromNode, gzip9, Buffer.from([0, 255])]);
  return [
    gzip1.toString("base64"), gzip6.toString("base64"), gzip9.toString("base64"), deflated.toString("base64"), raw.toString("base64"),
    zlib.gunzipSync(gzip9).toString() === text, zlib.inflateSync(deflated).toString() === text,
    zlib.inflateRawSync(raw).toString() === text, zlib.unzipSync(gzip6).toString() === text, zlib.unzipSync(deflated).toString() === text,
    zlib.gunzipSync(fromNode).toString(), zlib.unzipSync(multiMember).toString() === "hello" + text,
    zlib.gunzipSync(Buffer.concat([zlib.gzipSync("a".repeat(10000), { level: 0 }), fromNode])).toString() === "a".repeat(10000) + "hello",
  ];
}

export function zlibErrors() {
  return [
    errorOf(() => zlib.inflateSync(Buffer.from("xx"))), errorOf(() => zlib.inflateSync(Buffer.from("x"))),
    errorOf(() => zlib.inflateSync(Buffer.alloc(0))), errorOf(() => zlib.gzipSync("hello", { windowBits: 8 })),
    errorOf(() => zlib.gzipSync("hello", { level: "9" })), errorOf(() => zlib.deflateSync("hello", { memLevel: 10 })),
    errorOf(() => zlib.gzipSync("hello", { maxOutputLength: 2 })), errorOf(() => zlib.gzipSync(1)),
  ];
}

export function zlibCallbacks() {
  return new Promise((resolve) => {
    const order = [];
    zlib.gzip("callback payload", { level: 1 }, (compressionError, compressed) => {
      order.push("gzip");
      zlib.gunzip(compressed, (decompressionError, decoded) => {
        order.push("gunzip");
        zlib.inflate(Buffer.from("xx"), (badInput, missingOutput) => {
          resolve([order, compressionError, decompressionError, decoded.toString(), badInput.code, missingOutput === undefined]);
        });
      });
    });
    order.push("sync");
  });
}

export function phpOnlyZlibOutputCap() {
  const compressed = zlib.gzipSync("a".repeat(16 * 1024 * 1024 + 1), { level: 9 });
  return errorOf(() => zlib.gunzipSync(compressed));
}
