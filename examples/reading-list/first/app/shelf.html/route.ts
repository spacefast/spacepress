// GET /shelf.html: a route answers on the site's own path, outside /wp-json.
import { db } from "first";
import escapeHtml from "escape-html";
import ms from "ms";

export const access = "anyone";

export async function GET() {
  const list = await db.query.books.findMany({ columns: { title: true, minutesRead: true } });
  // escape-html and ms are npm packages. The compiler turns their code into PHP too.
  const items = list
    .map((b) => `<li>${escapeHtml(b.title)}: ${ms(b.minutesRead * 60_000, { long: true })}</li>`)
    .join("");
  return { headers: { "content-type": "text/html; charset=utf-8" }, body: `<ul>${items}</ul>` };
}
