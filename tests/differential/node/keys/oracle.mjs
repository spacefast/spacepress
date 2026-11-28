import assert from "node:assert/strict";
import { createPublicKey, sign, verify, publicEncrypt, privateDecrypt, constants } from "node:crypto";
import { rsaPrivate, rsaPublic, ecPrivate, ec384Private } from "./fixtures.mjs";

const note = "SpacePress crypto parity \u{1F510}";
const data = Buffer.from(note);
const from64 = (data) => Buffer.from(data, "base64");
const pss = { key: rsaPrivate, padding: constants.RSA_PKCS1_PSS_PADDING };
const unsupported = { name: "Error", code: "ERR_OSSL_UNSUPPORTED" };

export function inputFor(name) {
  switch (name) {
    case "rsaCross":
      return { signature: sign("sha256", data, rsaPrivate).toString("base64") };
    case "ecCross":
      return {
        der256: sign("sha256", data, ecPrivate).toString("base64"),
        raw256: sign("sha256", data, { key: ecPrivate, dsaEncoding: "ieee-p1363" }).toString("base64"),
        der384: sign("sha384", data, ec384Private).toString("base64"),
        raw384: sign("sha384", data, { key: ec384Private, dsaEncoding: "ieee-p1363" }).toString("base64"),
      };
    case "pssCross":
      return { signature: sign("sha256", data, { ...pss, saltLength: 17 }).toString("base64") };
    case "oaepCross":
      return {
        sha1: publicEncrypt(rsaPublic, data).toString("base64"),
        sha256: publicEncrypt({ key: rsaPublic, oaepHash: "sha256" }, data).toString("base64"),
      };
    default:
      return {};
  }
}

export function check(name, input, expected, actual, phpVersion) {
  switch (name) {
    case "rsaCross":
      assert.equal(actual.oracleSignatureValid, true);
      assert.equal(createPublicKey(actual.privateKey).equals(createPublicKey(actual.publicKey)), true);
      assert.equal(createPublicKey(actual.publicKey).asymmetricKeyDetails.modulusLength, 2048);
      assert.equal(verify("sha256", data, actual.publicKey, from64(actual.signature)), true);
      break;
    case "ecCross":
      for (const [index, digest, size] of [[0, "sha256", 64], [1, "sha384", 96]]) {
        const result = actual[index];
        assert.equal(result.oracleDerValid, true);
        assert.equal(result.oracleRawValid, true);
        assert.equal(verify(digest, data, result.publicKey, from64(result.der)), true);
        assert.equal(from64(result.raw).length, size);
        assert.equal(verify(digest, data, { key: result.publicKey, dsaEncoding: "ieee-p1363" }, from64(result.raw)), true);
      }
      break;
    case "pssCross":
      if (phpVersion < 80500) {
        assert.deepEqual(actual, unsupported);
        break;
      }
      for (const [index, saltLength] of [0, 17, 32, 222].entries()) {
        const options = { ...pss, key: rsaPublic, saltLength };
        const signature = from64(actual.signatures[index]);
        assert.equal(verify("sha256", data, options, signature), true);
        assert.equal(verify("sha256", data, { ...options, saltLength: saltLength === 0 ? 1 : 0 }, signature), false);
      }
      assert.equal(actual.oracleSignatureValid, true);
      assert.equal(actual.wrongSalt, false);
      break;
    case "oaepCross":
      assert.equal(actual[0], note);
      assert.equal(privateDecrypt(rsaPrivate, from64(actual[1])).toString(), note);
      if (phpVersion < 80500) {
        assert.deepEqual(actual[2], unsupported);
      } else {
        assert.equal(actual[2][0], note);
        assert.equal(privateDecrypt({ key: rsaPrivate, oaepHash: "sha256" }, from64(actual[2][1])).toString(), note);
      }
      break;
    default:
      assert.deepEqual(actual, expected);
  }
}
