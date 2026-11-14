import { action, defineConfig, text } from "first";
import { Files } from "files-sdk";
import { memory } from "files-sdk/memory";
import * as scenarios from "./first/scenarios.mjs";

// `probe` is the baseline from the files-sdk effort brief, kept verbatim so
// counts stay comparable. The other actions are the differential scenarios
// that ../verify.mjs compares with Node.
export const probe = action({
  access: "anyone",
  input: { key: text(), body: text() },
  async handler(input) {
    const files = new Files({ adapter: memory() });
    await files.upload(input.key, input.body, { contentType: "text/plain" });
    const got = await files.download(input.key);
    return { exists: await files.exists(input.key), text: await got.text() };
  },
});

export const roundtrip = action({
  access: "anyone",
  input: { key: text(), body: text() },
  async handler(input) {
    return await scenarios.roundtrip(input.key, input.body);
  },
});

export const listing = action({ access: "anyone", input: {}, async handler() { return await scenarios.listing(); } });
export const mutate = action({ access: "anyone", input: {}, async handler() { return await scenarios.mutate(); } });
export const handles = action({ access: "anyone", input: {}, async handler() { return await scenarios.handles(); } });
export const errors = action({ access: "anyone", input: {}, async handler() { return await scenarios.errors(); } });

export default defineConfig({ name: "files-sdk-probe" });
