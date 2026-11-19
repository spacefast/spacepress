// An original @spacefast/zero 0.8.1 capsule. `content-model.php` beside it is the original
// compiler's output for these collections (see capture.ts); the WordPress suite seeds a site the way
// the original kernel stored it, then imports that site into the config from `typedpress-migrate --from zero config`.
import { capsule } from "@spacefast/zero/server";

export default capsule({
  name: "legacy",
  collections: {
    projects: {
      label: "Projects",
      publicRead: true,
      fields: {
        title: { kind: "text", required: true, maxLength: 120 },
        budget: { kind: "number" },
        active: { kind: "boolean" },
        kickoff: { kind: "datetime" },
        stage: { kind: "enum", values: ["idea", "live", "done"] },
        tags: { kind: "enum", values: ["red", "green", "blue"], multiple: true },
        cover: { kind: "media" },
        gallery: { kind: "media", multiple: true },
      },
    },
    tasks: {
      label: "Tasks",
      publicRead: true,
      fields: {
        title: { kind: "text", required: true },
        notes: { kind: "text", multiline: true },
        project: { kind: "reference", to: "projects", required: true },
        parent: { kind: "reference", to: "tasks" },
      },
    },
  },
});
