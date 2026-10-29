import { defineConfig, defineType, defineField } from "sanity";

const note = defineType({
  name: "notes",
  type: "document",
  title: "Notes",
  fields: [
    defineField({ name: "title", type: "string", validation: Rule => Rule.required() }),
    defineField({ name: "description", type: "text" }),
    defineField({ name: "done", type: "boolean", initialValue: false }),
  ],
});

export default defineConfig({
  name: "default",
  projectId: "example",
  dataset: "production",
  schema: { types: [note] },
});
