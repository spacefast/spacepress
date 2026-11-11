import { action, defineConfig, text } from "first";
import { Files } from "files-sdk";
import { memory } from "files-sdk/memory";
import { errors, handles, listing, mutate, roundtrip } from "./first/scenarios.mjs";

// `probe` is the baseline from the files-sdk effort brief, kept verbatim so
// counts stay comparable. The other actions are the differential scenarios
// that ../verify.mjs compares with Node.
export default defineConfig({
  name: "files-sdk-probe",
  actions: {
    probe: action({
      access: "anyone",
      input: { key: text().notNull(), body: text().notNull() },
      async handler(input) {
        const files = new Files({ adapter: memory() });
        await files.upload(input.key, input.body, { contentType: "text/plain" });
        const got = await files.download(input.key);
        return { exists: await files.exists(input.key), text: await got.text() };
      },
    }),
    roundtrip: action({
      access: "anyone",
      input: { key: text().notNull(), body: text().notNull() },
      async handler(input) {
        return await roundtrip(input.key, input.body);
      },
    }),
    listing: action({ access: "anyone", input: {}, async handler() { return await listing(); } }),
    mutate: action({ access: "anyone", input: {}, async handler() { return await mutate(); } }),
    handles: action({ access: "anyone", input: {}, async handler() { return await handles(); } }),
    errors: action({ access: "anyone", input: {}, async handler() { return await errors(); } }),
  },
});
