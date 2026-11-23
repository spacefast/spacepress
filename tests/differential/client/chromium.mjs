// The Chromium the browser tests launch: SP_CHROMIUM when set, else undefined, which lets
// playwright-core launch the chromium-headless-shell revision it was built for. That is the one
// `npx --prefix tests/differential/client playwright-core install chromium-headless-shell` installs,
// on any platform, wherever Playwright keeps its browsers.
export function chromiumPath() {
  return process.env.SP_CHROMIUM || undefined;
}
