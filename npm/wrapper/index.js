// Finds the `zero` binary for this machine. The binaries ship as one optional dependency per
// platform, named `<this package>-<os>-<cpu>`; npm installs only the one whose `os` and `cpu`
// match, the way esbuild ships its binaries.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { name, optionalDependencies } = require("./package.json");

/** The platform package for this machine, e.g. `@spacefast/zero-v2-darwin-arm64`. */
export function platformPackage(platform = process.platform, arch = process.arch) {
  const candidate = `${name}-${platform}-${arch}`;
  return candidate in optionalDependencies ? candidate : null;
}

/** Absolute path of the `zero` binary. Throws with the fix when it cannot be found. */
export function binaryPath() {
  const pkg = platformPackage();
  if (pkg === null) {
    const supported = Object.keys(optionalDependencies).map((dep) => dep.slice(name.length + 1));
    throw new Error(
      `Zero has no binary for ${process.platform}-${process.arch}. Supported: ${supported.join(", ")}. ` +
        "Build it from source with `cargo build --release` in https://github.com/spacefast/zero.",
    );
  }
  try {
    return require.resolve(`${pkg}/bin/${process.platform === "win32" ? "zero.exe" : "zero"}`);
  } catch {
    throw new Error(
      `${pkg} is not installed. It is an optional dependency of ${name}; reinstall without ` +
        "--no-optional or --omit=optional.",
    );
  }
}
