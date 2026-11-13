// The app behind tests/compiler.rs `the_openapi_document_describes_what_the_api_answers`: one of
// every kind of thing the API serves, so every operation in first/_generated/openapi.json is called.
import { defineConfig, files } from "first";

export default defineConfig({
  name: "openapi",
  files: {
    decks: files("decks", { accept: ["text/plain"], maxBytes: 100_000, access: { read: "owner", create: "author", delete: "owner" } }),
  },
  services: { search: { notes: ["title"] } },
});
