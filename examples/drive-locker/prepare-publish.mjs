import { cp, lstat, mkdir, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("./", import.meta.url));
const destination = path.join(root, ".zero/publish");
const inputs = ["zero.config.ts", "lib", "zero/_generated/migrations", "public"];

async function rejectSymlinks(file) {
  const stat = await lstat(file);
  if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${file}`);
  if (stat.isDirectory()) {
    for (const child of await readdir(file)) await rejectSymlinks(path.join(file, child));
  } else if (!stat.isFile()) throw new Error(`Not a regular file: ${file}`);
}

await lstat(path.join(root, "public/index.html"));
for (const input of inputs) await rejectSymlinks(path.join(root, input));
await mkdir(destination, { recursive: true });
// Preserve the CLI's Space selection across later builds.
for (const entry of await readdir(destination)) {
  if (!["zero.config.ts", "lib", "zero", "public", ".spacefast"].includes(entry)) {
    throw new Error(`Unexpected publish input: ${entry}`);
  }
}
for (const directory of ["lib", "zero", "public"]) {
  await rm(path.join(destination, directory), { recursive: true, force: true });
}
for (const input of inputs) {
  await mkdir(path.dirname(path.join(destination, input)), { recursive: true });
  await cp(path.join(root, input), path.join(destination, input), { recursive: true });
}
console.log("Prepared .zero/publish with config, lib, migrations and built public assets only.");
