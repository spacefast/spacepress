// `typeof navigator` / `typeof process` and `navigator.platform` / `process.platform`, as npm
// packages detect Windows (picomatch 4.0.7's isWindows is included verbatim). Both `typeof` forms
// are the constant "object"; the two reads are strings computed by PHP when it runs
// (First\Host), never on the build machine. Every action runs under Node and as compiled PHP on the
// same machine; the JSON results must be byte-identical. See
// docs/decisions/2026-11-14-host-platform-detection.md.
import { action, defineConfig } from "first";
import { detection, guarded, members, picomatch, platforms, shadowed, withEnv } from "./host-platform-helpers.mjs";

const run = (handler: () => unknown) => action({ input: {}, handler });

function typedDetection(): string[] {
  return [typeof navigator, typeof process, typeof globalThis.navigator, typeof globalThis.process];
}

function typedPlatforms(): { navigator: string; process: string; windows: boolean } {
  const windows = navigator.platform.toLowerCase() === "win32" || process.platform === "win32";
  return { navigator: navigator.platform, process: process.platform, windows };
}

function typedGuard(): string {
  if (typeof process !== "undefined" && process.platform) return `process:${process.platform}`;
  return "none";
}

function typedShadow(process: { platform: string }): string {
  return process.platform;
}

function typedEnv(): string[] {
  return [process.platform, process.env.FIRST_HOST_PLATFORM_UNSET ?? "unset"];
}

export default defineConfig({
  name: "language-host-platform",
  actions: {
    picomatch: run(() => picomatch()),
    detection: run(() => detection()),
    platforms: run(() => platforms()),
    guarded: run(() => guarded()),
    members: run(() => members()),
    shadowed: run(() => shadowed()),
    withEnv: run(() => withEnv()),
    typedDetection: run(() => typedDetection()),
    typedPlatforms: run(() => typedPlatforms()),
    typedGuard: run(() => typedGuard()),
    typedShadow: run(() => typedShadow({ platform: "z" })),
    typedEnv: run(() => typedEnv()),
  },
});
