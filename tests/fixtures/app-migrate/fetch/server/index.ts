import { action, capsule, endpoint } from "@spacefast/zero/server";
export default capsule({
  name: "fetcher",
  actions: {
    raw: action(async (_ctx, url: string) => (await fetch(url)).json()),
    weather: action(async (ctx, city: string) => {
      const response = await fetch("https://api.example.com/w?q=" + encodeURIComponent(city), { headers: { accept: "application/json" } });
      if (!response.ok) return null;
      return (await response.json()) as { temperature: number };
    }),
  },
  endpoints: {
    // A returned body read in an endpoint: awaited, then 0.8's result rules (JSON for an object).
    proxy: endpoint({ method: "GET", path: "/api/proxy" }, async () => {
      const response = await fetch("https://api.example.com/status");
      return response.json();
    }),
  },
});
