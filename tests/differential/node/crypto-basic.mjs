import {
  createHash, createHmac, createSecretKey, getHashes, hash, hkdf, hkdfSync,
  pbkdf2, pbkdf2Sync, randomBytes, randomFillSync, randomInt, timingSafeEqual,
} from "node:crypto";

export function cryptoHashes() {
  const algorithms = ["md5", "sha1", "sha224", "sha256", "sha384", "sha512", "sha512-224", "sha512-256", "sha3-256", "sha3-384", "sha3-512"];
  const native = getHashes();
  const original = createHash("RSA-SHA256").update("a");
  const copy = original.copy();
  return {
    allAdvertised: algorithms.every(algorithm => native.includes(algorithm)),
    hashes: algorithms.map(algorithm => hash(algorithm, "abc")),
    dashedAlias: hash("sha-256", "abc"),
    initial: copy.digest("hex"),
    extended: original.update("b").digest("hex"),
    equal: timingSafeEqual(Buffer.from("ab"), new Uint8Array([97, 98])),
  };
}

export function cryptoKdfVectors() {
  const hmac = [
    ["Hi There", Buffer.alloc(20, 11)],
    ["what do ya want for nothing?", Buffer.from("Jefe")],
    [Buffer.alloc(50, 221), Buffer.alloc(20, 170)],
    [Buffer.alloc(50, 205), Buffer.from("0102030405060708090a0b0c0d0e0f10111213141516171819", "hex")],
    ["Test Using Larger Than Block-Size Key - Hash Key First", Buffer.alloc(131, 170)],
  ];
  const hmacResults = hmac.map(([message, key]) =>
    ["sha256", "sha512"].map(digest => createHmac(digest, createSecretKey(key)).update(message).digest("hex"))
  );
  const pbkdf2Results = [1, 2, 4096].map(rounds => pbkdf2Sync("password", "salt", rounds, 20, "sha1").toString("hex"));
  const ikm = Buffer.alloc(22, 11);
  const short = hkdfSync("sha256", ikm, Buffer.from("000102030405060708090a0b0c", "hex"), Buffer.from("f0f1f2f3f4f5f6f7f8f9", "hex"), 42);
  const longer = Buffer.from(Array.from({length: 80}, (_, i) => i));
  const salt = Buffer.from(Array.from({length: 80}, (_, i) => i + 80));
  const info = Buffer.from(Array.from({length: 80}, (_, i) => i + 160));
  const long = hkdfSync("sha256", longer, salt, info, 82);
  const empty = hkdfSync("sha256", ikm, "", "", 42);
  const noIkm = hkdfSync("sha256", "", "", "", 42);
  return [hmacResults, pbkdf2Results, [short, long, empty, noIkm].map(bytes => Buffer.from(bytes).toString("hex"))];
}

export async function cryptoCallbacks() {
  let sync = true;
  const random = new Promise((resolve, reject) => {
    randomBytes(8, (error, value) => error ? reject(error) : resolve([sync, value.length]));
  });
  const uniform = new Promise((resolve, reject) => {
    randomInt(5, 6, (error, value) => error ? reject(error) : resolve([sync, value]));
  });
  const derived = new Promise((resolve, reject) => {
    pbkdf2("password", "salt", 2, 20, "sha1", (error, bytes) => error ? reject(error) : resolve([sync, bytes.toString("hex")]));
  });
  const expanded = new Promise((resolve, reject) => {
    hkdf("sha256", "key", "", "", 8, (error, bytes) => error ? reject(error) : resolve([sync, Buffer.from(bytes).toString("hex")]));
  });
  sync = false;
  const bytes = Buffer.alloc(12);
  const same = randomFillSync(bytes.subarray(2, 10), 2, 4);
  return [await random, await uniform, await derived, await expanded, same.length, bytes.subarray(0, 4).toString("hex"), bytes.subarray(8).toString("hex")];
}

export function cryptoErrors() {
  const out = [];
  const checks = [
    () => createHmac("sha-999", "key"),
    () => timingSafeEqual(Buffer.alloc(1), Buffer.alloc(2)),
    () => pbkdf2Sync("password", "salt", 0, 1, "sha256"),
    () => randomInt(4, 4),
    () => randomBytes(-1),
  ];
  for (const run of checks) {
    try { run(); } catch (error) { out.push([error.name, error.code]); }
  }
  return out;
}

export function phpOnlyPbkdf2WorkCap() {
  try {
    pbkdf2Sync("password", "salt", 1000001, 32, "sha256");
    return "accepted";
  } catch (error) {
    return error.name + ":" + error.code;
  }
}
