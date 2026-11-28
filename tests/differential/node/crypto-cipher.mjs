import { createCipheriv, createDecipheriv, createSecretKey } from "node:crypto";

function errorOf(run) {
  try {
    run();
  } catch (error) {
    return `${error.name}:${error.code}`;
  }
  return "no error";
}

const gcmKey = "feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308";
const gcmIv = "cafebabefacedbaddecaf888";
const gcmAad = "feedfacedeadbeeffeedfacedeadbeefabaddad2";
const gcmPlaintext = "d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b391aafd255";
const gcmCiphertext = "522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662898015ad";

export function cipherGcm() {
  const key = createSecretKey(Buffer.from(gcmKey, "hex"));
  const iv = Buffer.from(gcmIv, "hex");
  const aad = Buffer.from(gcmAad, "hex");
  const plaintext = Buffer.from(gcmPlaintext, "hex");
  const noAad = createCipheriv("aes-256-gcm", key, iv);
  const full = Buffer.concat([noAad.update(plaintext.subarray(0, 13)), noAad.update(plaintext.subarray(13)), noAad.final()]);
  const withAad = createCipheriv("AES-256-GCM", key, iv);
  withAad.setAAD(aad.subarray(0, 7)).setAAD(aad.subarray(7));
  const shorter = plaintext.subarray(0, 60);
  const encrypted = Buffer.concat([withAad.update(shorter), withAad.final()]);
  const tag = Buffer.from("76fc6ece0f4e1768cddf8853bb2d551b", "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad).setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(gcmCiphertext.slice(0, 120), "hex")), decipher.final()]);
  const truncated = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 12 });
  truncated.setAAD(aad);
  const encoded = truncated.update(shorter, undefined, "base64") + truncated.final("base64");
  const truncatedTag = truncated.getAuthTag();
  const reopened = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 12 });
  reopened.setAAD(gcmAad, { encoding: "hex" }).setAuthTag(truncatedTag.toString("hex"), "hex");
  const roundTrip = reopened.update(Buffer.from(encoded, "base64"), undefined, "hex") + reopened.final("hex");
  return [
    full.toString("hex") === gcmCiphertext, noAad.getAuthTag().toString("hex") === "b094dac5d93471bdec1a502270e3cc6c",
    encrypted.toString("hex") === gcmCiphertext.slice(0, 120), withAad.getAuthTag().equals(tag), decrypted.equals(shorter),
    truncatedTag.length, Buffer.from(encoded, "base64").equals(encrypted), roundTrip === gcmPlaintext.slice(0, 120),
  ];
}

export function cipherCbc() {
  const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const iv = Buffer.alloc(16, 7);
  const results = [];
  for (const size of [0, 15, 16, 17, 33]) {
    const text = "a".repeat(size);
    const cipher = createCipheriv("aes-128-cbc", key, iv);
    const first = cipher.update(text.slice(0, 1));
    const second = cipher.update(text.slice(1));
    const encrypted = Buffer.concat([first, second, cipher.final()]);
    const decipher = createDecipheriv("aes-128-cbc", key, iv);
    const a = decipher.update(encrypted.subarray(0, 16));
    const b = decipher.update(encrypted.subarray(16, 17));
    const c = decipher.update(encrypted.subarray(17));
    results.push([first.length, second.length, a.length, b.length, c.length, encrypted.toString("hex"), Buffer.concat([a, b, c, decipher.final()]).toString()]);
  }
  const noPadding = createCipheriv("aes-128-cbc", key, iv).setAutoPadding(false);
  const encoded = noPadding.update("a".repeat(16), "utf8", "base64") + noPadding.update("b".repeat(16), "utf8", "base64") + noPadding.final("base64");
  const decipher = createDecipheriv("aes-128-cbc", key, iv).setAutoPadding(false);
  results.push([encoded, decipher.update(encoded, "base64", "utf8") + decipher.final("utf8")]);
  return results;
}

export function cipherErrors() {
  const key = Buffer.alloc(16);
  const iv = Buffer.alloc(12);
  const wrongTag = Buffer.alloc(16);
  const decipher = createDecipheriv("aes-128-gcm", key, iv).setAuthTag(wrongTag);
  decipher.update("unauthenticated ciphertext");
  const started = createCipheriv("aes-128-gcm", key, iv);
  started.update("abc");
  return [
    errorOf(() => createCipheriv("rot13", key, iv)),
    errorOf(() => createCipheriv("aes-256-gcm", key, iv)),
    errorOf(() => createCipheriv("aes-128-cbc", key, iv)),
    errorOf(() => createCipheriv("aes-128-gcm", key, iv, { authTagLength: 7 })),
    errorOf(() => createDecipheriv("aes-128-gcm", key, iv, { authTagLength: 12 }).setAuthTag(wrongTag)),
    errorOf(() => started.getAuthTag()), errorOf(() => started.setAAD("too late")),
    errorOf(() => decipher.final()), errorOf(() => decipher.final()),
    errorOf(() => {
      const block = createCipheriv("aes-128-cbc", key, Buffer.alloc(16)).setAutoPadding(false);
      block.update("abc");
      block.final();
    }),
  ];
}

export function phpOnlyCipherDoesNotReleaseUnauthenticatedBytes() {
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(gcmKey, "hex"), Buffer.from(gcmIv, "hex"));
  decipher.setAuthTag(Buffer.alloc(16));
  return [decipher.update(Buffer.from(gcmCiphertext, "hex")).length, errorOf(() => decipher.final())];
}
