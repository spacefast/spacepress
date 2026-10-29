import { capsule } from "@spacefast/zero/server";

export default capsule({
  name: "notes",
  collections: {
    notes: {
      label: "Notes",
      publicRead: true,
      fields: {
        title: { kind: "text", required: true, maxLength: 120 },
        priority: { kind: "number" },
        done: { kind: "boolean" },
        stage: { kind: "enum", values: ["todo", "done"] },
      },
    },
  },
});
