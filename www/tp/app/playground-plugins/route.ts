export const guard = "anyone";

// The literal directory route also keeps its public ZIPs on the runtime's file handler,
// which sends CORS headers even on dev servers that ignore .htaccess.
export function GET() {
  return {
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ plugins: [
      "/playground-plugins/typedpress-runtime.zip",
      "/playground-plugins/typedpress-identity.zip",
      "/playground-plugins/typedpress-admin.zip",
    ] }),
  };
}
