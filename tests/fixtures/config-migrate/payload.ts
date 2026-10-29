import { buildConfig } from "payload";

const notes = {
  slug: "notes",
  labels: { singular: "Note", plural: "Notes" },
  access: { read: true, create: false, update: false, delete: false },
  fields: [
    { name: "title", type: "text", required: true, maxLength: 120 },
    { name: "priority", type: "number", defaultValue: 2, min: 0, max: 5 },
    { name: "done", type: "checkbox", defaultValue: false },
    { name: "stage", type: "select", options: ["todo", "done"], defaultValue: "todo" },
  ],
};

export default buildConfig({ collections: [notes] });
