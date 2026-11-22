import { job, HttpError, mutation } from "typedpress";
import { examples, shares } from "typedpress:db";

// Saves a playground edit and answers with its key; /play?s=<key> opens it. Only the files the
// visitor changed are stored, and at most 200 KB of them.
export const share = mutation({ access: "anyone" }, async ({ example, files }: { example: string; files: unknown }) => {
  if (example.length > 40) throw new HttpError(422, "invalid_input", "example must be at most 40 characters", "/example");
  const size = (JSON.stringify(files) ?? "").length;
  if (size > 200_000) throw new HttpError(413, "too_large", "That edit is too large to share: the limit is 200 KB.");
  const key = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  await shares.system.create({ key, example, files });
  return { key };
});

// Asks GitHub for the star count of each example's repository and stores it on the row. It runs
// in the background on WordPress's job queue (Action Scheduler), never during a page view, so a
// slow or failing GitHub cannot slow the site. A repository GitHub will not show (private, or
// gone) keeps the count it had. GitHub is asked without a token, which allows 60 requests an hour.
export const refreshStars = job({ retries: 2 }, async () => {
  const rows = await examples.system.list({ limit: 100 });
  const counts = new Map<string, number | null>();
  for (const row of rows) {
    if (!counts.has(row.repo)) {
      const response = await fetch(`https://api.github.com/repos/${row.repo}`, { headers: { accept: "application/vnd.github+json", "user-agent": "typedpress-site" } });
      const body = response.ok ? ((await response.json()) as { stargazers_count?: number }) : {};
      counts.set(row.repo, typeof body.stargazers_count === "number" ? body.stargazers_count : null);
    }
    // `starsAt` is when GitHub was last asked, also when it gave no count, so a repository it
    // will not show is asked once a day and not on every page view.
    const stars = counts.get(row.repo);
    const checked = new Date().toISOString();
    await examples.system.update(row.id, stars == null ? { starsAt: checked } : { stars, starsAt: checked });
  }
});

// Starts a refresh now. An admin presses this; the site also starts one when the counts on the
// page are more than a day old (tp/app/examples/page.tsx).
export const refreshStarsNow = mutation({ access: "admin" }, async () => {
  await refreshStars.enqueue({}, { key: "refresh-stars" });
  return { queued: true };
});
