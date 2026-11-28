import { createPrivateKey, createPublicKey, subtle, webcrypto } from "node:crypto";
import { rsaPrivate, rsaPublic } from "./keys/fixtures.mjs";

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

export async function webCryptoHmac() {
  const data = new TextEncoder().encode("payload");
  const jwk = { kty: "oct", alg: "HS256", k: "c2VjcmV0", key_ops: ["sign", "verify"], ext: true };
  const key = await subtle.importKey("jwk", jwk, { name: "HMAC", hash: "SHA-256" }, true, ["sign", "verify"]);
  const signature = await subtle.sign("HMAC", key, data);
  const exported = await subtle.exportKey("jwk", key);
  return {
    sameObjects: globalThis.crypto === webcrypto && crypto.subtle === subtle,
    type: key.type,
    instance: key instanceof CryptoKey,
    algorithm: key.algorithm,
    usages: key.usages,
    serialised: JSON.stringify(key),
    signature: hex(signature),
    verify: await crypto.subtle.verify("HMAC", key, signature, data),
    badSignature: await subtle.verify("HMAC", key, data, data),
    exported,
  };
}

export async function webCryptoRsa() {
  const data = new TextEncoder().encode("sign this payload");
  const parameters = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  const privateDer = createPrivateKey(rsaPrivate).export({ type: "pkcs8", format: "der" });
  const publicDer = createPublicKey(rsaPublic).export({ type: "spki", format: "der" });
  const privateKey = await subtle.importKey("pkcs8", privateDer, parameters, false, ["sign"]);
  const publicKey = await subtle.importKey("spki", publicDer, parameters, true, ["verify"]);
  const signature = await subtle.sign(parameters.name, privateKey, data);
  return {
    signature: hex(signature),
    verified: await subtle.verify(parameters.name, publicKey, signature, data),
    jwk: await subtle.exportKey("jwk", publicKey),
    modulusLength: publicKey.algorithm.modulusLength,
    exponent: Array.from(publicKey.algorithm.publicExponent),
  };
}

export async function webCryptoAes() {
  const message = new TextEncoder().encode("confidential payload");
  const raw = new Uint8Array(32);
  const algorithm = { name: "AES-GCM", iv: new Uint8Array(12), additionalData: new Uint8Array([1, 2, 3]), tagLength: 96 };
  const key = await subtle.importKey("raw", raw, algorithm.name, true, ["encrypt", "decrypt"]);
  const encrypted = await subtle.encrypt(algorithm, key, message);
  const decrypted = await subtle.decrypt(algorithm, key, encrypted);
  const tampered = new Uint8Array(encrypted.slice(0));
  tampered[0] = tampered[0] ^ 1;
  let failure = "";
  try { await subtle.decrypt(algorithm, key, tampered); } catch (error) { failure = error.name; }
  const cbc = { name: "AES-CBC", iv: new Uint8Array(16) };
  const cbcKey = await subtle.importKey("raw", raw, cbc.name, true, ["encrypt", "decrypt"]);
  const cbcData = await subtle.encrypt(cbc, cbcKey, message);
  return [hex(encrypted), hex(decrypted), hex(cbcData), hex(await subtle.decrypt(cbc, cbcKey, cbcData)), failure];
}

export async function webCryptoDerive() {
  const raw = new TextEncoder().encode("password");
  const salt = new TextEncoder().encode("salt");
  const algorithm = { name: "PBKDF2", salt, iterations: 4096, hash: { name: "SHA-256" } };
  const key = await subtle.importKey("raw", raw, algorithm.name, false, ["deriveBits", "deriveKey"]);
  const bits = await subtle.deriveBits(algorithm, key, 256);
  const derivedKey = await subtle.deriveKey(algorithm, key, { name: "AES-GCM", length: 128 }, true, ["encrypt"]);
  const hkdfKey = await subtle.importKey("raw", raw, "HKDF", false, ["deriveBits"]);
  const hkdfBits = await subtle.deriveBits({ name: "HKDF", salt, info: new Uint8Array([1,2]), hash: "SHA-256" }, hkdfKey, 128);
  return [hex(bits), hex(await subtle.exportKey("raw", derivedKey)), hex(hkdfBits)];
}

export async function webCryptoPolicy() {
  const data = new Uint8Array([1,2,3,4]);
  const key = await subtle.importKey("raw", data, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const writable = new Uint8Array(10);
  const view = writable.subarray(2, 8);
  const sameView = crypto.getRandomValues(view) === view;
  const errors = [];
  const runs = [
    () => subtle.exportKey("raw", key),
    () => subtle.verify("HMAC", key, data, data),
    () => subtle.importKey("raw", data, "PBKDF2", true, ["deriveBits"]),
    () => subtle.generateKey({ name: "HMAC", hash: "SHA-256", length: 1 }, true, ["sign"]),
    () => subtle.digest("SHA-3", data),
    () => subtle.digest("SHA-256", "oops"),
    () => crypto.getRandomValues(new Float32Array(2)),
    () => crypto.getRandomValues(new Uint8Array(65537)),
  ];
  for (const run of runs) {
    try { await run(); } catch (error) { errors.push(error.name); }
  }
  return [sameView, hex(writable.subarray(0, 2)), hex(writable.subarray(8)), errors];
}

export async function webCryptoGenerated() {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const data = new Uint8Array([1,2,3,4]);
  const params = { name: "ECDSA", hash: "SHA-256" };
  const signature = await subtle.sign(params, pair.privateKey, data);
  const jwk = await subtle.exportKey("jwk", pair.publicKey);
  const imported = await subtle.importKey("jwk", jwk, pair.publicKey.algorithm, true, ["verify"]);
  const raw = await subtle.exportKey("raw", pair.publicKey);
  const rawKey = await subtle.importKey("raw", raw, pair.publicKey.algorithm, true, ["verify"]);
  return [pair.privateKey.extractable, pair.publicKey.extractable, signature.byteLength, await subtle.verify(params, imported, signature, data), raw.byteLength, await subtle.verify(params, rawKey, signature, data)];
}
