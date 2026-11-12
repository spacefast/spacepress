// files-sdk@3.1.2 dist/chunk-2hcch65w.js lines 16-87 (src/internal/md5.ts), unmodified apart from
// the export below. MIT License, Copyright (c) 2026 Hayden Bleasel; see FILES-SDK-NOTICE.txt.
// src/internal/md5.ts
var SINES = Uint32Array.of(3614090360, 3905402710, 606105819, 3250441966, 4118548399, 1200080426, 2821735955, 4249261313, 1770035416, 2336552879, 4294925233, 2304563134, 1804603682, 4254626195, 2792965006, 1236535329, 4129170786, 3225465664, 643717713, 3921069994, 3593408605, 38016083, 3634488961, 3889429448, 568446438, 3275163606, 4107603335, 1163531501, 2850285829, 4243563512, 1735328473, 2368359562, 4294588738, 2272392833, 1839030562, 4259657740, 2763975236, 1272893353, 4139469664, 3200236656, 681279174, 3936430074, 3572445317, 76029189, 3654602809, 3873151461, 530742520, 3299628645, 4096336452, 1126891415, 2878612391, 4237533241, 1700485571, 2399980690, 4293915773, 2240044497, 1873313359, 4264355552, 2734768916, 1309151649, 4149444226, 3174756917, 718787259, 3951481745);
var SHIFTS = Uint8Array.of(7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21);
var BLOCK_BYTES = 64;
var LENGTH_OFFSET = 56;
var add32 = (x, y) => x + y | 0;
var compress = (state, view, offset) => {
  let { a, b, c, d } = state;
  for (let step = 0;step < 64; step += 1) {
    const round = step >>> 4;
    let mixed;
    let word;
    if (round === 0) {
      mixed = b & c | ~b & d;
      word = step;
    } else if (round === 1) {
      mixed = d & b | ~d & c;
      word = 5 * step + 1 & 15;
    } else if (round === 2) {
      mixed = b ^ c ^ d;
      word = 3 * step + 5 & 15;
    } else {
      mixed = c ^ (b | ~d);
      word = 7 * step & 15;
    }
    const sine = SINES[step];
    const shift = SHIFTS[round << 2 | step & 3];
    const sum = a + mixed + sine + view.getUint32(offset + word * 4, true);
    a = d;
    d = c;
    c = b;
    b = add32(b, sum << shift | sum >>> 32 - shift);
  }
  state.a = add32(state.a, a);
  state.b = add32(state.b, b);
  state.c = add32(state.c, c);
  state.d = add32(state.d, d);
};
var md5Hex = (bytes) => {
  const state = {
    a: 1732584193,
    b: 4023233417,
    c: 2562383102,
    d: 271733878
  };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const whole = bytes.byteLength - bytes.byteLength % BLOCK_BYTES;
  for (let offset = 0;offset < whole; offset += BLOCK_BYTES) {
    compress(state, view, offset);
  }
  const leftover = bytes.byteLength - whole;
  const tail = new Uint8Array(leftover < LENGTH_OFFSET ? BLOCK_BYTES : BLOCK_BYTES * 2);
  tail.set(bytes.subarray(whole));
  tail[leftover] = 128;
  const tailView = new DataView(tail.buffer);
  const bits = bytes.byteLength * 8;
  tailView.setUint32(tail.byteLength - 8, bits, true);
  tailView.setUint32(tail.byteLength - 4, Math.floor(bits / 2 ** 32), true);
  for (let offset = 0;offset < tail.byteLength; offset += BLOCK_BYTES) {
    compress(state, tailView, offset);
  }
  const digest = new DataView(new ArrayBuffer(16));
  digest.setUint32(0, state.a, true);
  digest.setUint32(4, state.b, true);
  digest.setUint32(8, state.c, true);
  digest.setUint32(12, state.d, true);
  let hex = "";
  for (let at = 0;at < digest.byteLength; at += 1) {
    hex += digest.getUint8(at).toString(16).padStart(2, "0");
  }
  return hex;
};
export { md5Hex };
