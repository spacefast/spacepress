// The app behind tests/compiler.rs `the_openapi_document_describes_what_the_api_answers`: one of
// every kind of thing the API serves, so every operation in tp/_generated/openapi.json is called.
import { defineConfig, files } from "typedpress";

export const decks = files({ accept: ["text/plain"], maxBytes: 100_000, access: { read: "owner", create: "author", delete: "owner" } });

export default defineConfig({
  name: "openapi",
});
