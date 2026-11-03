import { defineConfig } from "zero";

// Like upstream blank: no application content model or sample publication.
// WordPress's native posts, pages, editor, media and settings remain available.
export default defineConfig({ name: "emdash-blank", admin: false });
