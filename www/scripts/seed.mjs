// Seeds the examples listed by this build through the app API. Existing rows keep their edits
// and star counts; rerunning adds only missing names. Authentication comes from the environment.
import { readFileSync } from "node:fs";

const site = new URL("../", import.meta.url);
const base = (process.env.SITE_URL ?? "http://localhost:8960").replace(/\/$/, "");
const password = process.env.FIRST_APP_PASSWORD;
if (!password) throw new Error("set FIRST_APP_PASSWORD to an administrator's username:application-password");
const headers = { authorization: `Basic ${Buffer.from(password).toString("base64")}`, "content-type": "application/json" };
const api = `${base}/__first/api/v1/examples`;
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) throw new Error(`examples API returned HTTP ${response.status}`);
  return response.json();
}
const current = await request(`${api}?limit=100`);
if (!Array.isArray(current.data)) throw new Error("examples API returned no data array");
const names = new Set(current.data.map((row) => row.name));
const build = JSON.parse(readFileSync(new URL("public/play-data.json", site), "utf8"));
const featured = ["website", "reading-list", "pantry", "blog", "full-site"];
let added = 0;
for (const [position, name] of featured.entries()) {
  if (names.has(name)) continue;
  const example = build.examples[name];
  if (!example || typeof example.title !== "string" || typeof example.summary !== "string") throw new Error(`build has no example metadata for ${name}`);
  await request(api, { method: "POST", body: JSON.stringify({ name, title: example.title, summary: example.summary, repo: "spacefast/zero", path: name === "website" ? "www" : `examples/${name}`, position }) });
  added++;
}
console.log(`examples: ${added} added; existing rows retained`);
