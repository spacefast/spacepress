// Writes tests/php/fixtures/bigint-vectors.json: random BigInt operands and Node's result for each
// operation that tests/php/bigint_test.php checks First\JsBigInt against. Seeded, so reruns are stable.
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const big = () => {
  const len = Math.floor(rnd() * 40) + 1;
  let s = String(Math.floor(rnd() * 9) + 1);
  for (let i = 1; i < len; i++) s += Math.floor(rnd() * 10);
  if (rnd() < 0.15) s = String(Math.floor(rnd() * 3));
  return (rnd() < 0.5 ? -1n : 1n) * BigInt(s);
};
const out = [];
const t = (f) => { try { return String(f()); } catch (e) { return e.name; } };
for (let i = 0; i < 400; i++) {
  const a = big(), b = big(), s = BigInt(Math.floor(rnd() * 200) - 100);
  out.push([String(a), String(b), String(s), t(() => a + b), t(() => a - b), t(() => a * b), t(() => a / b), t(() => a % b),
    t(() => a & b), t(() => a | b), t(() => a ^ b), t(() => ~a), t(() => a << s), t(() => a >> s), String(a < b), String(a === b),
    t(() => a ** (s < 0n ? -s % 7n : s % 7n)), t(() => a.toString(16)), t(() => a.toString(36)), t(() => Number(a)), t(() => BigInt.asIntN(64, a)), t(() => BigInt.asUintN(13, a))]);
}
process.stdout.write(JSON.stringify(out));
