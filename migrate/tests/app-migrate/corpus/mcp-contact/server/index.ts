import { capsule, endpoint, string, table, text } from "@spacefast/zero/server";
export default capsule({
  name: "Contact Form",
  schema: { contacts: table({ email: string() }) },
  endpoints: {
    ping: endpoint({ mode: "read", method: "GET", path: "/api/ping" }, () => text("ok")),
  },
});
