import { action, defineConfig, text } from "zero";
import { Files } from "files-sdk";
import { memory } from "files-sdk/memory";

// The baseline probe from the files-sdk effort brief: one action that builds a
// memory-backed Files instance and round-trips one object.
export default defineConfig({
  name: "files-sdk-probe",
  actions: {
    roundtrip: action({
      access: "anyone",
      input: { key: text().notNull(), body: text().notNull() },
      async handler(input) {
        const files = new Files({ adapter: memory() });
        await files.upload(input.key, input.body, { contentType: "text/plain" });
        const got = await files.download(input.key);
        return { exists: await files.exists(input.key), text: await got.text() };
      },
    }),
  },
});
