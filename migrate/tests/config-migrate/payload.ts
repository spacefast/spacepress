import { buildConfig } from "payload";

const notes = {
  slug: "notes",
  labels: { singular: "Note", plural: "Notes" },
  access: { read: true, create: false, update: false, delete: false },
  fields: [
    { name: "title", type: "text", required: true, maxLength: 120, unique: true },
    { name: "body", type: "textarea", required: true },
    { name: "tags", type: "select", options: ["one", "two"], hasMany: true, required: true },
    { name: "priority", type: "number", defaultValue: 2, min: 0, max: 5 },
    { name: "contact", type: "email" },
    { name: "done", type: "checkbox", required: true },
    { name: "stage", type: "select", options: ["todo", "done"], defaultValue: "todo" },
    { name: "details", type: "json", required: true, defaultValue: [] },
    { name: "archived", type: "checkbox" },
  ],
};

export default buildConfig({ collections: [notes] });
