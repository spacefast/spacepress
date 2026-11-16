// The chromium-headless-shell the browser tests launch: FIRST_CHROMIUM, else the newest one in
// Playwright's cache (~/.cache/ms-playwright on Linux, ~/Library/Caches/ms-playwright on macOS).
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function chromiumPath() {
  if (process.env.FIRST_CHROMIUM) return process.env.FIRST_CHROMIUM;
  for (const cache of [join(homedir(), ".cache/ms-playwright"), join(homedir(), "Library/Caches/ms-playwright")]) {
    if (!existsSync(cache)) continue;
    for (const shell of readdirSync(cache).filter((n) => n.startsWith("chromium_headless_shell-")).sort().reverse()) {
      for (const dir of ["chrome-headless-shell-linux64", "chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64"]) {
        const bin = join(cache, shell, dir, "chrome-headless-shell");
        if (existsSync(bin)) return bin;
      }
    }
  }
  throw new Error("no chromium-headless-shell: run npx --prefix tests/differential/client playwright-core install chromium-headless-shell");
}
