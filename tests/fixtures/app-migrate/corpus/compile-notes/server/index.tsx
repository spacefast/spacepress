import { action, capsule, connector, endpoint, ImageResponse, mutation, query as read, number as numeric, userId as ownerId, string, table, text } from "@spacefast/zero/server";

const notes = read(async (ctx) => ctx.db.notes.withIndex("by_creation").collect());
const addNote = mutation(async (ctx, body: string) => ctx.db.notes.insert({ body }));
const unused = { phantom: read(() => "not registered") };
const queries = { notes };
export default capsule({
  name: "Notes",
  connectors: { tracker: connector({ as: "team", connector: "github" }) },
  schema: { notes: table({ body: string(), weight: numeric().optional().default(-1.5), owner: ownerId(), label: string().optional() }).index("by_weight", ["weight"]) },
  queries,
  mutations: { addNote },
  actions: { notify: action(async (_ctx, url: string) => (await fetch(url)).json()) },
  endpoints: {
    ping: endpoint({ method: "GET", path: "/api/ping" }, () => text("ok")),
    image: endpoint(
      { readOnly: true, method: "POST", path: "/og.png" },
      () => new ImageResponse(<div>Notes</div>),
    ),
    record: endpoint({ method: "GET", path: "/api/record", readOnly: false }, () => text("ok")),
  },
});
