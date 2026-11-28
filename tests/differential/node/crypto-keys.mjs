import {
  KeyObject, createPrivateKey, createPublicKey, createSecretKey,
  generateKeyPair, generateKeyPairSync, createSign, createVerify, sign, verify,
  publicEncrypt, privateDecrypt, privateEncrypt, publicDecrypt, constants,
} from "node:crypto";
import {
  rsaPrivate, rsaPublic, rsaPrivatePkcs1, rsaPublicPkcs1,
  ecPrivate, ecPublic, ec384Private, ec384Public, edPrivate, edPublic,
} from "./keys/fixtures.mjs";

const note = "SpacePress crypto parity \u{1F510}";
const caught = (operation) => {
  try {
    return operation();
  } catch (error) {
    return { name: error.name, code: error.code };
  }
};
const pem = (type) => ({ format: "pem", type });
const der = (type) => ({ format: "der", type });
const jwk = { format: "jwk" };

function exportsFor(key, types) {
  const formats = types.map((type) => [key.export(pem(type)), key.export(der(type)).toString("base64")]);
  formats.push(key.export(jwk));
  return formats;
}
function roundTrips(privatePem, publicPem, type) {
  const privateKey = createPrivateKey(privatePem);
  const publicKey = createPublicKey(publicPem);
  return [
    createPrivateKey({ key: privateKey.export(der(type)), ...der(type) }).equals(privateKey),
    createPublicKey({ key: publicKey.export(der("spki")), ...der("spki") }).equals(publicKey),
    createPrivateKey({ key: privateKey.export(jwk), ...jwk }).equals(privateKey),
    createPublicKey({ key: publicKey.export(jwk), ...jwk }).equals(publicKey),
    createPublicKey({ key: privateKey.export(jwk), ...jwk }).equals(publicKey),
    createPublicKey(privateKey).equals(publicKey),
    createPublicKey({ key: privateKey }).equals(publicKey),
    createPublicKey(privatePem).equals(publicKey),
    privateKey.equals(publicKey),
  ];
}

export function encodedKeys() {
  return [
    exportsFor(createPrivateKey(rsaPrivate), ["pkcs1", "pkcs8"]),
    exportsFor(createPrivateKey(rsaPrivatePkcs1), ["pkcs1", "pkcs8"]),
    exportsFor(createPublicKey(rsaPublic), ["pkcs1", "spki"]),
    exportsFor(createPublicKey(rsaPublicPkcs1), ["spki"]),
    exportsFor(createPrivateKey(ecPrivate), ["sec1", "pkcs8"]),
    exportsFor(createPublicKey(ecPublic), ["spki"]),
    exportsFor(createPrivateKey(ec384Private), ["sec1", "pkcs8"]),
    exportsFor(createPublicKey(ec384Public), ["spki"]),
    exportsFor(createPrivateKey(edPrivate), ["pkcs8"]),
    exportsFor(createPublicKey(edPublic), ["spki"]),
    roundTrips(rsaPrivate, rsaPublic, "pkcs1"),
    roundTrips(ecPrivate, ecPublic, "sec1"),
    roundTrips(ec384Private, ec384Public, "pkcs8"),
    roundTrips(edPrivate, edPublic, "pkcs8"),
    createPublicKey({ key: createPublicKey(rsaPublic).export(der("pkcs1")), ...der("pkcs1") }).equals(createPublicKey(rsaPublic)),
  ];
}

export function keyProperties() {
  const privateKey = createPrivateKey(rsaPrivate);
  const publicKey = createPublicKey(edPublic);
  const secret = createSecretKey("bGl0dGxl", "base64");
  const ec = createPrivateKey(ec384Private);
  const rsa = privateKey.asymmetricKeyDetails;
  return {
    privateType: privateKey.type,
    publicType: publicKey.type,
    secretType: secret.type,
    privateAlgorithm: privateKey.asymmetricKeyType,
    publicAlgorithm: publicKey.asymmetricKeyType,
    publicDetails: Object.keys(publicKey.asymmetricKeyDetails),
    modulusLength: rsa.modulusLength,
    exponent: rsa.publicExponent.toString(),
    exponentType: typeof rsa.publicExponent,
    namedCurve: ec.asymmetricKeyDetails.namedCurve,
    isKey: secret instanceof KeyObject,
    size: secret.symmetricKeySize,
    raw: secret.export().toString(),
    jwk: secret.export(jwk),
    equal: secret.equals(createSecretKey(Buffer.from("little"))),
    unequal: secret.equals(createSecretKey(Buffer.from("other"))),
    empty: createSecretKey(Buffer.alloc(0)).export(jwk),
    printed: String(secret),
    keys: Object.keys(secret),
    hidden: secret.material === undefined && privateKey.material === undefined,
  };
}

export function deterministicSignatures() {
  const data = Buffer.from(note);
  const rsaSignature = sign("RSA-SHA256", data, rsaPrivate);
  const signer = createSign("sha256");
  const verifier = createVerify("RSA-SHA256");
  const chunkSignature = signer.update(data.subarray(0, 7)).update(data.subarray(7)).sign(rsaPrivate, "base64");
  const edSignature = sign(null, data, edPrivate);
  const privateCiphertext = privateEncrypt(rsaPrivate, data);
  return [
    rsaSignature.toString("base64"), chunkSignature, edSignature.toString("base64"),
    verifier.update(data).verify(rsaPublic, chunkSignature, "base64"),
    createSign("sha256").update(note, null).sign(rsaPrivate, "buffer").equals(rsaSignature),
    verify("sha256", data, createPrivateKey(rsaPrivate), rsaSignature),
    verify(null, data, edPublic, edSignature),
    verify(null, data, createPrivateKey(edPrivate), edSignature),
    verify(null, data, edPublic, edSignature.subarray(1)),
    privateCiphertext.toString("base64"), publicDecrypt(rsaPublic, privateCiphertext).toString(),
    caught(() => createPrivateKey("nope")),
    caught(() => sign("sha256", data, rsaPublic)),
    caught(() => sign("sha256", data, createPublicKey(rsaPublic))),
  ];
}

export async function generatedKeyCallback() {
  const received = await new Promise((resolve, reject) => {
    generateKeyPair("ed25519", {
      publicKeyEncoding: der("spki"), privateKeyEncoding: pem("pkcs8"),
    }, (error, publicKey, privateKey) => {
      if (error) reject(error);
      else resolve([publicKey, privateKey]);
    });
  });
  const [publicKey, privateKey] = received;
  return [
    Buffer.isBuffer(publicKey), typeof privateKey, publicKey.length,
    verify(null, Buffer.from(note), { key: publicKey, ...der("spki") }, sign(null, Buffer.from(note), privateKey)),
  ];
}

export function rsaCross(input) {
  const data = Buffer.from(note);
  const generated = generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent: 65537 });
  return {
    publicKey: generated.publicKey.export(pem("spki")),
    privateKey: generated.privateKey.export(pem("pkcs8")),
    signature: sign("sha256", data, generated.privateKey).toString("base64"),
    oracleSignatureValid: verify("sha256", data, rsaPublic, Buffer.from(input.signature, "base64")),
  };
}

export function ecCross(input) {
  const data = Buffer.from(note);
  const output = [];
  for (const [curve, hash, publicPem, derSig, rawSig] of [
    ["P-256", "sha256", ecPublic, input.der256, input.raw256],
    ["P-384", "sha384", ec384Public, input.der384, input.raw384],
  ]) {
    const generated = generateKeyPairSync("ec", { namedCurve: curve });
    output.push({
      publicKey: generated.publicKey.export(pem("spki")),
      der: sign(hash, data, generated.privateKey).toString("base64"),
      raw: sign(hash, data, { key: generated.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64"),
      oracleDerValid: verify(hash, data, publicPem, Buffer.from(derSig, "base64")),
      oracleRawValid: verify(hash, data, { key: publicPem, dsaEncoding: "ieee-p1363" }, Buffer.from(rawSig, "base64")),
    });
  }
  return output;
}

export function pssCross(input) {
  return caught(() => {
    const data = Buffer.from(note);
    const signOptions = { key: rsaPrivate, padding: constants.RSA_PKCS1_PSS_PADDING };
    const verifyOptions = { key: rsaPublic, padding: constants.RSA_PKCS1_PSS_PADDING };
    return {
      signatures: [0, 17, constants.RSA_PSS_SALTLEN_DIGEST, constants.RSA_PSS_SALTLEN_AUTO]
        .map((saltLength) => sign("sha256", data, { ...signOptions, saltLength }).toString("base64")),
      oracleSignatureValid: verify("sha256", data, { ...verifyOptions, saltLength: 17 }, Buffer.from(input.signature, "base64")),
      wrongSalt: verify("sha256", data, { ...verifyOptions, saltLength: 18 }, Buffer.from(input.signature, "base64")),
    };
  });
}

export function oaepCross(input) {
  const data = Buffer.from(note);
  return [
    privateDecrypt(rsaPrivate, Buffer.from(input.sha1, "base64")).toString(),
    publicEncrypt(rsaPublic, data).toString("base64"),
    caught(() => [
      privateDecrypt({ key: rsaPrivate, oaepHash: "sha256" }, Buffer.from(input.sha256, "base64")).toString(),
      publicEncrypt({ key: rsaPublic, oaepHash: "sha256" }, data).toString("base64"),
    ]),
  ];
}
