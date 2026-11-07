import { action, capsule } from "@spacefast/zero/server";
export default capsule({
  name: "fetcher",
  actions: {
    weather: action(async (ctx, city: string) => {
      const response = await fetch("https://api.example.com/w?q=" + encodeURIComponent(city), { headers: { accept: "application/json" } });
      if (!response.ok) return null;
      return (await response.json()) as { temperature: number };
    }),
  },
});
