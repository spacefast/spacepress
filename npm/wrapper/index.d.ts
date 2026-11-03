/** The platform package for this machine, or null when Zero ships no binary for it. */
export function platformPackage(platform?: NodeJS.Platform, arch?: NodeJS.Architecture): string | null;
/** Absolute path of the `zero` binary. Throws with the fix when it cannot be found. */
export function binaryPath(): string;
