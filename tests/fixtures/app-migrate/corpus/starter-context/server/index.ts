import { capsule } from "@spacefast/zero/server";

export default capsule({
  name: "Context",
  collections: { pages: { fields: { content: { kind: "blocks", source: "content/context.blocks" } } } },
});
