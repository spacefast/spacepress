import { defineConfig, query, f } from "spacepress";
import { Files } from "files-sdk";
import { memory } from "files-sdk/memory";
import * as scenarios from "./sp/scenarios.mjs";

// `probe` is the baseline from the files-sdk effort brief, kept verbatim so
// counts stay comparable. The other actions are the differential scenarios
// that ../verify.mjs compares with Node.
export const probe = query({ access: "anyone" }, async (_ctx, input: { key: string; body: string }) => {
  const files = new Files({ adapter: memory() });
  await files.upload(input.key, input.body, { contentType: "text/plain" });
  const got = await files.download(input.key);
  return { exists: await files.exists(input.key), text: await got.text() };
});

export const roundtrip = query({ access: "anyone" }, async (_ctx, input: { key: string; body: string }) => {
  return await scenarios.roundtrip(input.key, input.body);
});

export const listing = query({ access: "anyone" }, async () => { return await scenarios.listing(); });
export const mutate = query({ access: "anyone" }, async () => { return await scenarios.mutate(); });
export const handles = query({ access: "anyone" }, async () => { return await scenarios.handles(); });
export const errors = query({ access: "anyone" }, async () => { return await scenarios.errors(); });

export default defineConfig({ name: "files-sdk-probe" });
